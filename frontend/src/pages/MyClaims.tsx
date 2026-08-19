import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS } from '../config/contracts.ts';
import VeriflowClaimNFTABI from '../config/abis/VeriflowClaimNFT.json';
import VeriflowClaimVaultABI from '../config/abis/VeriflowClaimVault.json';
import MockStablecoinABI from '../config/abis/MockStablecoin.json';

const NFT_ADDR = CONTRACTS.VeriflowClaimNFT as `0x${string}`;
const VAULT_ADDR = CONTRACTS.VeriflowClaimVault as `0x${string}`;
const TOKEN_ADDR = CONTRACTS.MockStablecoin as `0x${string}`;

const CLAIM_TYPE_LABELS = ['Invoice', 'Royalty', 'Rental'] as const;

type ClaimStatus =
  | 'Awaiting Collateral'
  | 'Open for Funding'
  | 'Funded - Repayment Due'
  | 'Evidence Submitted - Challenge Window Open'
  | 'Disputed'
  | 'Repaid & Closed';

interface ClaimData {
  claimType: number;
  amount: bigint;
  dueDate: bigint;
  debtorRef: `0x${string}`;
  originator: string;
}

interface CollateralData {
  amount: bigint;
  locked: boolean;
}

interface FundingData {
  investor: string;
  fundedAmount: bigint;
  funded: boolean;
  evidenced: boolean;
  evidenceHash: `0x${string}`;
  repaymentAmount: bigint;
  repaymentDeposited: boolean;
  fundedAt: bigint;
  disputed: boolean;
  disputeEvidenceHash: `0x${string}`;
}

interface MyClaimRow {
  id: bigint;
  claim: ClaimData;
  collateral: CollateralData;
  funding: FundingData;
  status: ClaimStatus;
  requiredRepayment: bigint;
  yieldAmount: bigint;
  challengeEndsAt: bigint;
}

function normalizeClaimData(raw: unknown): ClaimData | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return {
      claimType: Number(raw[0] ?? 0),
      amount: BigInt(raw[1] ?? 0),
      dueDate: BigInt(raw[2] ?? 0),
      debtorRef: (raw[3] ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
      originator: String(raw[4] ?? ''),
    };
  }

  const claim = raw as Partial<ClaimData>;
  return {
    claimType: Number(claim.claimType ?? 0),
    amount: BigInt(claim.amount ?? 0),
    dueDate: BigInt(claim.dueDate ?? 0),
    debtorRef: (claim.debtorRef ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
    originator: String(claim.originator ?? ''),
  };
}

function normalizeCollateralData(raw: unknown): CollateralData | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return {
      amount: BigInt(raw[0] ?? 0),
      locked: Boolean(raw[1]),
    };
  }

  const collateral = raw as Partial<CollateralData>;
  return {
    amount: BigInt(collateral.amount ?? 0),
    locked: Boolean(collateral.locked),
  };
}

function normalizeFundingData(raw: unknown): FundingData | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return {
      investor: String(raw[0] ?? '0x0000000000000000000000000000000000000000'),
      fundedAmount: BigInt(raw[1] ?? 0),
      funded: Boolean(raw[2]),
      evidenced: Boolean(raw[3]),
      evidenceHash: (raw[4] ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
      repaymentAmount: BigInt(raw[5] ?? 0),
      repaymentDeposited: Boolean(raw[6]),
      fundedAt: BigInt(raw[7] ?? 0),
      disputed: Boolean(raw[8]),
      disputeEvidenceHash: (raw[9] ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
    };
  }

  const funding = raw as Partial<FundingData>;
  return {
    investor: String(funding.investor ?? '0x0000000000000000000000000000000000000000'),
    fundedAmount: BigInt(funding.fundedAmount ?? 0),
    funded: Boolean(funding.funded),
    evidenced: Boolean(funding.evidenced),
    evidenceHash: (funding.evidenceHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
    repaymentAmount: BigInt(funding.repaymentAmount ?? 0),
    repaymentDeposited: Boolean(funding.repaymentDeposited),
    fundedAt: BigInt(funding.fundedAt ?? 0),
    disputed: Boolean(funding.disputed),
    disputeEvidenceHash: (funding.disputeEvidenceHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
  };
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return '00:00:00';
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toBytes32(input: string): `0x${string}` {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed as `0x${string}`;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(trimmed).slice(0, 32);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return (`0x${hex.padEnd(64, '0')}`) as `0x${string}`;
}

function statusBadgeClass(status: ClaimStatus): string {
  if (status === 'Awaiting Collateral') return 'vf-badge-yellow';
  if (status === 'Open for Funding') return 'vf-badge-green';
  if (status === 'Funded - Repayment Due') return 'vf-badge-purple';
  if (status === 'Evidence Submitted - Challenge Window Open') return 'vf-badge-yellow';
  if (status === 'Disputed') return 'vf-badge-red';
  return 'vf-badge-green';
}

function ClaimCard({
  row,
  challengeWindow,
  userBalance,
}: {
  row: MyClaimRow;
  challengeWindow: bigint;
  userBalance: bigint;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [evidenceInput, setEvidenceInput] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [actionState, setActionState] = useState<'idle' | 'submitting-evidence' | 'approving' | 'depositing' | 'done'>('idle');
  const [error, setError] = useState('');
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const intervalId = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const dueDateText = new Date(Number(row.claim.dueDate) * 1000).toLocaleDateString();
  const challengeEndSec = Number(row.challengeEndsAt);
  const countdownSec = Math.max(0, challengeEndSec - nowSec);

  const canSubmitEvidence = row.status === 'Funded - Repayment Due';
  const canDepositRepayment =
    row.status === 'Evidence Submitted - Challenge Window Open' &&
    row.funding.evidenced &&
    !row.funding.repaymentDeposited;

  const insufficientBalance = userBalance < row.requiredRepayment;

  async function handleSubmitEvidence() {
    setError('');
    setTxHash(null);

    if (!evidenceInput.trim()) {
      setError('Please enter an evidence hash or note.');
      return;
    }

    try {
      setActionState('submitting-evidence');
      const evidenceHash = toBytes32(evidenceInput);
      const hash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: VeriflowClaimVaultABI,
        functionName: 'submitRepaymentEvidence',
        args: [row.id, evidenceHash],
      });

      setTxHash(hash);
      await publicClient!.waitForTransactionReceipt({ hash });
      setActionState('done');
    } catch (e: unknown) {
      setActionState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleApproveAndDeposit() {
    setError('');
    setTxHash(null);

    if (insufficientBalance) {
      setError('Insufficient mUSD balance for required repayment amount.');
      return;
    }

    try {
      setActionState('approving');
      const approveHash = await writeContractAsync({
        address: TOKEN_ADDR,
        abi: MockStablecoinABI,
        functionName: 'approve',
        args: [VAULT_ADDR, row.requiredRepayment],
      });
      setTxHash(approveHash);
      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      setActionState('depositing');
      const depositHash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: VeriflowClaimVaultABI,
        functionName: 'depositRepayment',
        args: [row.id, row.requiredRepayment],
      });
      setTxHash(depositHash);
      await publicClient!.waitForTransactionReceipt({ hash: depositHash });

      setActionState('done');
    } catch (e: unknown) {
      setActionState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="vf-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-h)', fontFamily: 'var(--mono)', fontSize: '0.9rem' }}>#{row.id.toString()}</span>
          <span className="vf-badge vf-badge-purple">{CLAIM_TYPE_LABELS[row.claim.claimType] ?? 'Unknown'}</span>
          <span className={`vf-badge ${statusBadgeClass(row.status)}`}>{row.status}</span>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>Due {dueDateText}</span>
      </div>

      <div className="vf-stats">
        <div className="vf-stat">
          <span className="vf-stat-label">Claim Amount</span>
          <span className="vf-stat-value">{formatUnits(row.claim.amount, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Collateral</span>
          <span className="vf-stat-value">{row.collateral.locked ? `${formatUnits(row.collateral.amount, 18)} mUSD` : 'Not locked'}</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Funded Principal</span>
          <span className="vf-stat-value">{row.funding.funded ? `${formatUnits(row.funding.fundedAmount, 18)} mUSD` : 'Not funded'}</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Repayment Required</span>
          <span className="vf-stat-value">{row.funding.funded ? `${formatUnits(row.requiredRepayment, 18)} mUSD` : '-'}</span>
        </div>
      </div>

      {row.status === 'Evidence Submitted - Challenge Window Open' && (
        <div className="vf-alert vf-alert-info" style={{ fontSize: '0.85rem' }}>
          Challenge window length: {Number(challengeWindow)}s. {countdownSec > 0
            ? `Time remaining: ${formatCountdown(countdownSec)}`
            : 'Challenge window time has elapsed; settlement can proceed if undisputed.'}
        </div>
      )}

      {canSubmitEvidence && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div className="vf-field" style={{ marginTop: 0 }}>
            <label>Repayment Evidence Hash / Note</label>
            <input
              className="vf-input"
              placeholder="0x... (bytes32) or plain-text note"
              value={evidenceInput}
              onChange={(e) => setEvidenceInput(e.target.value)}
              disabled={actionState !== 'idle'}
            />
          </div>
          <button
            className="vf-btn vf-btn-primary"
            onClick={handleSubmitEvidence}
            disabled={!evidenceInput.trim() || actionState !== 'idle'}
          >
            {actionState === 'submitting-evidence' ? 'Submitting evidence...' : 'Submit Repayment Evidence'}
          </button>
        </div>
      )}

      {canDepositRepayment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div className="vf-alert vf-alert-info" style={{ fontSize: '0.85rem' }}>
            You must repay {formatUnits(row.requiredRepayment, 18)} mUSD ({formatUnits(row.funding.fundedAmount, 18)} mUSD principal + {formatUnits(row.yieldAmount, 18)} mUSD yield).
          </div>
          {insufficientBalance && (
            <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem' }}>
              Insufficient mUSD balance. You have {formatUnits(userBalance, 18)} mUSD but need {formatUnits(row.requiredRepayment, 18)} mUSD.
            </div>
          )}
          <button
            className="vf-btn vf-btn-primary"
            onClick={handleApproveAndDeposit}
            disabled={insufficientBalance || actionState !== 'idle'}
          >
            {actionState === 'approving'
              ? 'Approving mUSD...'
              : actionState === 'depositing'
                ? 'Depositing repayment...'
                : 'Approve mUSD & Deposit Repayment'}
          </button>
        </div>
      )}

      {row.funding.repaymentDeposited && row.status !== 'Repaid & Closed' && (
        <div className="vf-alert vf-alert-success" style={{ fontSize: '0.85rem' }}>
          Repayment has been deposited on-chain. Awaiting distribution and collateral release.
        </div>
      )}

      {row.status === 'Repaid & Closed' && (
        <div className="vf-alert vf-alert-success" style={{ fontSize: '0.85rem' }}>
          This claim is fully settled: repayment distributed and collateral released.
        </div>
      )}

      {txHash && (
        <div className="vf-alert vf-alert-success">
          Tx submitted:{' '}
          <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">
            {txHash}
          </a>
        </div>
      )}

      {actionState === 'done' && (
        <div className="vf-alert vf-alert-success">Confirmed on-chain. Refresh this page/tab to load updated status.</div>
      )}

      {error && <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>{error}</div>}
    </div>
  );
}

export default function MyClaims() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | My Claims';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi originator dashboard for claim status, repayment evidence, and repayment deposits.');

    return () => {
      document.title = previousTitle;
      if (createdMeta) {
        meta?.remove();
      } else {
        meta?.setAttribute('content', previousDescription);
      }
    };
  }, []);

  const { address, isConnected } = useAccount();

  const { data: totalRaw, isLoading: loadingTotal } = useReadContract({
    address: NFT_ADDR,
    abi: VeriflowClaimNFTABI,
    functionName: 'totalClaims',
  });

  const { data: challengeWindowRaw } = useReadContract({
    address: VAULT_ADDR,
    abi: VeriflowClaimVaultABI,
    functionName: 'challengeWindow',
  });

  const { data: userBalanceRaw } = useReadContract({
    address: TOKEN_ADDR,
    abi: MockStablecoinABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query: { enabled: !!address },
  });

  const totalClaims = totalRaw as bigint ?? 0n;
  const challengeWindow = challengeWindowRaw as bigint ?? 0n;
  const userBalance = userBalanceRaw as bigint ?? 0n;

  const claimContracts = useMemo(() =>
    Array.from({ length: Number(totalClaims) }, (_, i) => ({
      address: NFT_ADDR,
      abi: VeriflowClaimNFTABI as any,
      functionName: 'claims',
      args: [BigInt(i)],
    })), [totalClaims]);

  const collateralContracts = useMemo(() =>
    Array.from({ length: Number(totalClaims) }, (_, i) => ({
      address: NFT_ADDR,
      abi: VeriflowClaimNFTABI as any,
      functionName: 'collateral',
      args: [BigInt(i)],
    })), [totalClaims]);

  const fundingContracts = useMemo(() =>
    Array.from({ length: Number(totalClaims) }, (_, i) => ({
      address: VAULT_ADDR,
      abi: VeriflowClaimVaultABI as any,
      functionName: 'funding',
      args: [BigInt(i)],
    })), [totalClaims]);

  const { data: claimsData, isLoading: loadingClaims } = useReadContracts({
    contracts: claimContracts,
    query: { enabled: totalClaims > 0n },
  });

  const { data: collateralData, isLoading: loadingCollateral } = useReadContracts({
    contracts: collateralContracts,
    query: { enabled: totalClaims > 0n },
  });

  const { data: fundingData, isLoading: loadingFunding } = useReadContracts({
    contracts: fundingContracts,
    query: { enabled: totalClaims > 0n },
  });

  const myClaims = useMemo((): MyClaimRow[] => {
    if (!address || !claimsData || !collateralData || !fundingData) return [];

    const caller = address.toLowerCase();
    const rows: MyClaimRow[] = [];

    for (let i = 0; i < Number(totalClaims); i++) {
      const claim = normalizeClaimData(claimsData[i]?.result);
      const collateral = normalizeCollateralData(collateralData[i]?.result);
      const funding = normalizeFundingData(fundingData[i]?.result);

      if (!claim || !collateral || !funding) continue;
      if (!claim.originator || claim.originator.toLowerCase() !== caller) continue;

      const principal = funding.fundedAmount ?? 0n;
      const yieldAmount = principal * 1000n / 10_000n;
      const requiredRepayment = principal + yieldAmount;
      const challengeEndsAt = (funding.fundedAt ?? 0n) + challengeWindow;

      let status: ClaimStatus;

      if (funding.disputed) {
        status = 'Disputed';
      } else if (!collateral.locked && !funding.funded && funding.repaymentDeposited) {
        status = 'Repaid & Closed';
      } else if (!collateral.locked) {
        status = 'Awaiting Collateral';
      } else if (collateral.locked && !funding.funded) {
        status = 'Open for Funding';
      } else if (funding.funded && !funding.evidenced) {
        status = 'Funded - Repayment Due';
      } else if (funding.evidenced) {
        status = 'Evidence Submitted - Challenge Window Open';
      } else {
        status = 'Open for Funding';
      }

      rows.push({
        id: BigInt(i),
        claim,
        collateral,
        funding,
        status,
        requiredRepayment,
        yieldAmount,
        challengeEndsAt,
      });
    }

    return rows.reverse();
  }, [address, claimsData, collateralData, fundingData, totalClaims, challengeWindow]);

  const isLoading = loadingTotal || loadingClaims || loadingCollateral || loadingFunding;

  if (!isConnected) {
    return (
      <div className="vf-connect-wall">
        <p>Connect your wallet to view your claims.</p>
      </div>
    );
  }

  return (
    <div className="vf-page">
      <h2>My Claims</h2>
      <p className="sub">Track each minted claim through collateral, funding, evidence, disputes, and final settlement.</p>

      {isLoading && (
        <div className="vf-alert vf-alert-info">Loading your claims from chain...</div>
      )}

      {!isLoading && myClaims.length === 0 && (
        <div className="vf-card">
          <p style={{ margin: 0, color: 'var(--text)', textAlign: 'center', padding: '1rem 0' }}>
            You have not minted any claims yet. Start from <strong>List a Claim</strong>.
          </p>
        </div>
      )}

      {myClaims.map((row) => (
        <ClaimCard
          key={row.id.toString()}
          row={row}
          challengeWindow={challengeWindow}
          userBalance={userBalance}
        />
      ))}
    </div>
  );
}
