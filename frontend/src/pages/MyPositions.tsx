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

const NFT_ADDR = CONTRACTS.VeriflowClaimNFT as `0x${string}`;
const VAULT_ADDR = CONTRACTS.VeriflowClaimVault as `0x${string}`;

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

interface PositionRow {
  id: bigint;
  claim: ClaimData;
  collateral: CollateralData;
  funding: FundingData;
  status: ClaimStatus;
  expectedRepayment: bigint;
  yieldAmount: bigint;
  challengeEndsAt: bigint;
}

interface DecodeIssue {
  source: 'claims' | 'collateral' | 'funding';
  claimId: number;
  message: string;
  raw: unknown;
}

interface ParsedPositionsResult {
  rows: PositionRow[];
  decodeIssue: DecodeIssue | null;
}

function hasKey<T extends string>(obj: unknown, key: T): obj is Record<T, unknown> {
  return !!obj && typeof obj === 'object' && key in obj;
}

function asBigInt(value: unknown, field: string): bigint {
  try {
    return BigInt(value as bigint | number | string);
  } catch {
    throw new Error(`Invalid bigint field: ${field}`);
  }
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Invalid boolean field: ${field}`);
}

function asAddress(value: unknown, field: string): string {
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  throw new Error(`Invalid address field: ${field}`);
}

function asBytes32(value: unknown, field: string): `0x${string}` {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid bytes32 field: ${field}`);
}

function normalizeClaimData(raw: unknown): ClaimData {
  if (!raw) throw new Error('Missing claims() result');
  if (Array.isArray(raw)) {
    if (raw.length < 5) throw new Error('claims() tuple length mismatch');
    return {
      claimType: Number(raw[0]),
      amount: asBigInt(raw[1], 'claims.amount'),
      dueDate: asBigInt(raw[2], 'claims.dueDate'),
      debtorRef: asBytes32(raw[3], 'claims.debtorRef'),
      originator: asAddress(raw[4], 'claims.originator'),
    };
  }

  if (!hasKey(raw, 'claimType') || !hasKey(raw, 'amount') || !hasKey(raw, 'dueDate') || !hasKey(raw, 'debtorRef') || !hasKey(raw, 'originator')) {
    throw new Error('Unrecognized claims() return shape');
  }

  const claim = raw as Record<string, unknown>;
  return {
    claimType: Number(claim.claimType),
    amount: asBigInt(claim.amount, 'claims.amount'),
    dueDate: asBigInt(claim.dueDate, 'claims.dueDate'),
    debtorRef: asBytes32(claim.debtorRef, 'claims.debtorRef'),
    originator: asAddress(claim.originator, 'claims.originator'),
  };
}

function normalizeCollateralData(raw: unknown): CollateralData {
  if (!raw) throw new Error('Missing collateral() result');
  if (Array.isArray(raw)) {
    if (raw.length < 2) throw new Error('collateral() tuple length mismatch');
    return {
      amount: asBigInt(raw[0], 'collateral.amount'),
      locked: asBoolean(raw[1], 'collateral.locked'),
    };
  }

  if (!hasKey(raw, 'amount') || !hasKey(raw, 'locked')) {
    throw new Error('Unrecognized collateral() return shape');
  }

  const collateral = raw as Record<string, unknown>;
  return {
    amount: asBigInt(collateral.amount, 'collateral.amount'),
    locked: asBoolean(collateral.locked, 'collateral.locked'),
  };
}

function normalizeFundingData(raw: unknown): FundingData {
  if (!raw) throw new Error('Missing funding() result');
  if (Array.isArray(raw)) {
    if (raw.length < 10) throw new Error('funding() tuple length mismatch');
    return {
      investor: asAddress(raw[0], 'funding.investor'),
      fundedAmount: asBigInt(raw[1], 'funding.fundedAmount'),
      funded: asBoolean(raw[2], 'funding.funded'),
      evidenced: asBoolean(raw[3], 'funding.evidenced'),
      evidenceHash: asBytes32(raw[4], 'funding.evidenceHash'),
      repaymentAmount: asBigInt(raw[5], 'funding.repaymentAmount'),
      repaymentDeposited: asBoolean(raw[6], 'funding.repaymentDeposited'),
      fundedAt: asBigInt(raw[7], 'funding.fundedAt'),
      disputed: asBoolean(raw[8], 'funding.disputed'),
      disputeEvidenceHash: asBytes32(raw[9], 'funding.disputeEvidenceHash'),
    };
  }

  if (
    !hasKey(raw, 'investor') ||
    !hasKey(raw, 'fundedAmount') ||
    !hasKey(raw, 'funded') ||
    !hasKey(raw, 'evidenced') ||
    !hasKey(raw, 'evidenceHash') ||
    !hasKey(raw, 'repaymentAmount') ||
    !hasKey(raw, 'repaymentDeposited') ||
    !hasKey(raw, 'fundedAt') ||
    !hasKey(raw, 'disputed') ||
    !hasKey(raw, 'disputeEvidenceHash')
  ) {
    throw new Error('Unrecognized funding() return shape');
  }

  const funding = raw as Record<string, unknown>;
  return {
    investor: asAddress(funding.investor, 'funding.investor'),
    fundedAmount: asBigInt(funding.fundedAmount, 'funding.fundedAmount'),
    funded: asBoolean(funding.funded, 'funding.funded'),
    evidenced: asBoolean(funding.evidenced, 'funding.evidenced'),
    evidenceHash: asBytes32(funding.evidenceHash, 'funding.evidenceHash'),
    repaymentAmount: asBigInt(funding.repaymentAmount, 'funding.repaymentAmount'),
    repaymentDeposited: asBoolean(funding.repaymentDeposited, 'funding.repaymentDeposited'),
    fundedAt: asBigInt(funding.fundedAt, 'funding.fundedAt'),
    disputed: asBoolean(funding.disputed, 'funding.disputed'),
    disputeEvidenceHash: asBytes32(funding.disputeEvidenceHash, 'funding.disputeEvidenceHash'),
  };
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

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return '00:00:00';
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusBadgeClass(status: ClaimStatus): string {
  if (status === 'Awaiting Collateral') return 'vf-badge-yellow';
  if (status === 'Open for Funding') return 'vf-badge-green';
  if (status === 'Funded - Repayment Due') return 'vf-badge-purple';
  if (status === 'Evidence Submitted - Challenge Window Open') return 'vf-badge-yellow';
  if (status === 'Disputed') return 'vf-badge-red';
  return 'vf-badge-green';
}

function PositionCard({ row, challengeWindow }: { row: PositionRow; challengeWindow: bigint }) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [disputeInput, setDisputeInput] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [actionState, setActionState] = useState<'idle' | 'raising-dispute' | 'done'>('idle');
  const [error, setError] = useState('');
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const intervalId = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const dueDateText = new Date(Number(row.claim.dueDate) * 1000).toLocaleDateString();
  const challengeEndSec = Number(row.challengeEndsAt);
  const countdownSec = Math.max(0, challengeEndSec - nowSec);
  const challengeWindowActive = countdownSec > 0;

  const canRaiseDispute =
    row.status === 'Evidence Submitted - Challenge Window Open' &&
    challengeWindowActive &&
    row.funding.funded &&
    !row.funding.repaymentDeposited &&
    !row.funding.disputed;

  async function handleRaiseDispute() {
    setError('');
    setTxHash(null);

    if (!disputeInput.trim()) {
      setError('Please enter dispute evidence hash or note.');
      return;
    }

    try {
      setActionState('raising-dispute');
      const disputeHash = toBytes32(disputeInput);
      const hash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: VeriflowClaimVaultABI,
        functionName: 'raiseDispute',
        args: [row.id, disputeHash],
      });
      setTxHash(hash);
      await publicClient!.waitForTransactionReceipt({ hash });
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
          <span className="vf-stat-label">Funded Amount</span>
          <span className="vf-stat-value">{formatUnits(row.funding.fundedAmount, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Expected Repayment</span>
          <span className="vf-stat-value">{formatUnits(row.expectedRepayment, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Principal + Yield</span>
          <span className="vf-stat-value">{formatUnits(row.funding.fundedAmount, 18)} + {formatUnits(row.yieldAmount, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Originator</span>
          <span className="vf-stat-value" style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>{row.claim.originator.slice(0, 10)}…{row.claim.originator.slice(-6)}</span>
        </div>
      </div>

      {row.funding.evidenced && (
        <div className="vf-alert vf-alert-info" style={{ fontSize: '0.85rem' }}>
          Challenge window length: {Number(challengeWindow)}s. {challengeWindowActive
            ? `Time remaining: ${formatCountdown(countdownSec)}`
            : 'Challenge window elapsed.'}
        </div>
      )}

      {canRaiseDispute && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div className="vf-field" style={{ marginTop: 0 }}>
            <label>Dispute Evidence Hash / Note</label>
            <input
              className="vf-input"
              placeholder="0x... (bytes32) or plain-text note"
              value={disputeInput}
              onChange={(e) => setDisputeInput(e.target.value)}
              disabled={actionState !== 'idle'}
            />
          </div>
          <button
            className="vf-btn vf-btn-primary"
            onClick={handleRaiseDispute}
            disabled={!disputeInput.trim() || actionState !== 'idle'}
          >
            {actionState === 'raising-dispute' ? 'Raising dispute...' : 'Raise Dispute'}
          </button>
        </div>
      )}

      {row.status === 'Repaid & Closed' && (
        <div className="vf-alert vf-alert-success" style={{ fontSize: '0.85rem' }}>
          This position is settled and closed.
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

export default function MyPositions() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | My Positions';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi investor dashboard for funded positions, expected repayments, challenge windows, and disputes.');

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
  const [decodeError, setDecodeError] = useState<DecodeIssue | null>(null);

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

  const totalClaims = totalRaw as bigint ?? 0n;
  const challengeWindow = challengeWindowRaw as bigint ?? 0n;

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

  const parsedPositions = useMemo((): ParsedPositionsResult => {
    if (!address || !claimsData || !collateralData || !fundingData) {
      return { rows: [], decodeIssue: null };
    }

    const caller = address.toLowerCase();
    const rows: PositionRow[] = [];
    let decodeIssue: DecodeIssue | null = null;

    for (let i = 0; i < Number(totalClaims); i++) {
      let claim: ClaimData;
      let collateral: CollateralData;
      let funding: FundingData;

      try {
        claim = normalizeClaimData(claimsData[i]?.result);
      } catch (error: unknown) {
        decodeIssue ??= {
          source: 'claims',
          claimId: i,
          message: error instanceof Error ? error.message : String(error),
          raw: claimsData[i]?.result,
        };
        continue;
      }

      try {
        collateral = normalizeCollateralData(collateralData[i]?.result);
      } catch (error: unknown) {
        decodeIssue ??= {
          source: 'collateral',
          claimId: i,
          message: error instanceof Error ? error.message : String(error),
          raw: collateralData[i]?.result,
        };
        continue;
      }

      try {
        funding = normalizeFundingData(fundingData[i]?.result);
      } catch (error: unknown) {
        decodeIssue ??= {
          source: 'funding',
          claimId: i,
          message: error instanceof Error ? error.message : String(error),
          raw: fundingData[i]?.result,
        };
        continue;
      }

      if (!funding.investor || funding.investor.toLowerCase() !== caller) continue;

      const yieldAmount = funding.fundedAmount * 1000n / 10_000n;
      const expectedRepayment = funding.fundedAmount + yieldAmount;
      const challengeEndsAt = funding.fundedAt + challengeWindow;

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
        expectedRepayment,
        yieldAmount,
        challengeEndsAt,
      });
    }

    return { rows: rows.reverse(), decodeIssue };
  }, [address, claimsData, collateralData, fundingData, totalClaims, challengeWindow]);

  const positions = parsedPositions.rows;

  useEffect(() => {
    setDecodeError(parsedPositions.decodeIssue);
  }, [parsedPositions.decodeIssue]);

  useEffect(() => {
    if (!decodeError) return;

    console.warn('[MyPositions] decode warning', {
      source: decodeError.source,
      claimId: decodeError.claimId,
      message: decodeError.message,
      raw: decodeError.raw,
    });
  }, [decodeError]);

  const isLoading = loadingTotal || loadingClaims || loadingCollateral || loadingFunding;

  if (!isConnected) {
    return (
      <div className="vf-connect-wall">
        <p>Connect your wallet to view your investor positions.</p>
      </div>
    );
  }

  return (
    <div className="vf-page">
      <h2>My Positions</h2>
      <p className="sub">Track funded claims, expected repayment, settlement progress, and disputes from the investor side.</p>

      {isLoading && (
        <div className="vf-alert vf-alert-info">Loading investor positions from chain...</div>
      )}

      {decodeError && (
        <div className="vf-alert vf-alert-error" style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
          Decode warning on claim #{decodeError.claimId} ({decodeError.source}): {decodeError.message}. Check console for raw payload.
        </div>
      )}

      {!isLoading && positions.length === 0 && (
        <div className="vf-card">
          <p style={{ margin: 0, color: 'var(--text)', textAlign: 'center', padding: '1rem 0' }}>
            You do not have any funded positions yet.
          </p>
        </div>
      )}

      {positions.map((row) => (
        <PositionCard key={row.id.toString()} row={row} challengeWindow={challengeWindow} />
      ))}
    </div>
  );
}
