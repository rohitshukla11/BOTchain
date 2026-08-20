import { useEffect, useMemo, useState } from 'react';
import React from 'react';
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

interface DecodeIssue {
  source: 'claims' | 'collateral' | 'funding';
  claimId: number;
  message: string;
  raw: unknown;
}

interface ParsedClaimsResult {
  rows: MyClaimRow[];
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

function lifecycleState(row: MyClaimRow): { pct: number; caption: string } {
  if (row.status === 'Disputed')        return { pct: 60,  caption: 'Disputed · pending arbitration' };
  if (row.status === 'Repaid & Closed') return { pct: 100, caption: 'Settled · closed' };
  if (row.funding.repaymentDeposited)   return { pct: 83,  caption: 'Repayment deposited · finalizing' };
  if (row.status === 'Evidence Submitted - Challenge Window Open') return { pct: 66, caption: 'Evidence submitted · challenge window open' };
  if (row.status === 'Funded - Repayment Due') return { pct: 50, caption: 'Funded · repayment due' };
  if (row.status === 'Open for Funding')       return { pct: 33, caption: 'Minted · awaiting investor' };
  return { pct: 16, caption: 'Minted · awaiting collateral' };
}

function statusPillStyle(status: ClaimStatus): React.CSSProperties {
  if (status === 'Open for Funding')   return { background: 'rgba(46,230,197,0.18)', color: '#2ee6c5' };
  if (status === 'Funded - Repayment Due') return { background: 'rgba(124,92,255,0.18)', color: '#c4b0ff' };
  if (status === 'Evidence Submitted - Challenge Window Open') return { background: 'rgba(245,182,92,0.15)', color: '#f5b65c' };
  if (status === 'Disputed') return { background: 'rgba(239,83,80,0.15)', color: '#ef5350' };
  if (status === 'Repaid & Closed') return { background: 'rgba(46,230,197,0.12)', color: '#2ee6c5' };
  return { background: 'rgba(245,182,92,0.15)', color: '#f5b65c' }; // Awaiting Collateral
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
  const [actionState, setActionState] = useState<
    'idle' |
    'submitting-evidence' |
    'approving' |
    'depositing' |
    'finalizing-distribution' |
    'finalizing-release' |
    'done'
  >('idle');
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

  const challengeWindowElapsed = countdownSec === 0;
  const canFinalizeSettlement =
    row.funding.repaymentDeposited &&
    row.funding.funded &&
    row.collateral.locked &&
    !row.funding.disputed;

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

  async function handleFinalizeSettlement() {
    setError('');
    setTxHash(null);

    if (!challengeWindowElapsed) {
      setError('Challenge window is still active. Wait for the countdown to reach zero before finalizing.');
      return;
    }

    try {
      setActionState('finalizing-distribution');
      const distributeHash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: VeriflowClaimVaultABI,
        functionName: 'distributeToInvestors',
        args: [row.id],
      });
      setTxHash(distributeHash);
      await publicClient!.waitForTransactionReceipt({ hash: distributeHash });

      setActionState('finalizing-release');
      const releaseHash = await writeContractAsync({
        address: NFT_ADDR,
        abi: VeriflowClaimNFTABI,
        functionName: 'releaseCollateral',
        args: [row.id],
      });
      setTxHash(releaseHash);
      await publicClient!.waitForTransactionReceipt({ hash: releaseHash });

      setActionState('done');
    } catch (e: unknown) {
      setActionState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const { pct, caption } = lifecycleState(row);
  const typeIcon = row.claim.claimType === 0 ? '📄' : row.claim.claimType === 1 ? '🎵' : '🏠';
  const iconCls  = row.claim.claimType === 0 ? 'dash-row-icon--invoice' : row.claim.claimType === 1 ? 'dash-row-icon--royalty' : 'dash-row-icon--rental';
  const claimLabel = CLAIM_TYPE_LABELS[row.claim.claimType] ?? 'Unknown';

  // Compact closed row
  if (row.status === 'Repaid & Closed') {
    return (
      <div className="mc-closed-row">
        <span className={`dash-row-icon ${iconCls}`} style={{ width: '1.8rem', height: '1.8rem', fontSize: '0.85rem' }}>{typeIcon}</span>
        <div className="mc-closed-left">
          <div>
            <div className="dash-row-title">{claimLabel} #{row.id.toString()}</div>
            <div className="dash-row-sub">Settled</div>
          </div>
        </div>
        <div className="mc-closed-right">
          <span className="mc-yield-text">+{formatUnits(row.yieldAmount, 18)} yield paid</span>
          <span className="mc-status-pill" style={{ background: 'rgba(245,246,248,0.08)', color: 'var(--text)' }}>Repaid &amp; closed</span>
        </div>
      </div>
    );
  }

  // Active claim card
  return (
    <div className="mc-card">
      {/* Header: icon + name/date | status pill */}
      <div className="mc-card-header">
        <div className="mc-card-left">
          <span className={`dash-row-icon ${iconCls}`}>{typeIcon}</span>
          <div className="mc-card-info">
            <span className="mc-card-name">{claimLabel} #{row.id.toString()}</span>
            <span className="mc-card-date">Due {dueDateText}</span>
          </div>
        </div>
        <span className="mc-status-pill" style={statusPillStyle(row.status)}>{row.status}</span>
      </div>

      {/* 4-col data grid */}
      <div className="mc-data-grid">
        <div className="mc-data-cell">
          <span className="mc-data-label">Claim</span>
          <span className="mc-data-val">{Number(formatUnits(row.claim.amount, 18)).toLocaleString()}</span>
        </div>
        <div className="mc-data-cell">
          <span className="mc-data-label">Collateral</span>
          <span className={`mc-data-val${row.collateral.locked ? '' : ' mc-data-val--muted'}`}>
            {row.collateral.locked ? Number(formatUnits(row.collateral.amount, 18)).toLocaleString() : '—'}
          </span>
        </div>
        <div className="mc-data-cell">
          <span className="mc-data-label">Funded</span>
          <span className={`mc-data-val${row.funding.funded ? '' : ' mc-data-val--muted'}`}>
            {row.funding.funded ? Number(formatUnits(row.funding.fundedAmount, 18)).toLocaleString() : '—'}
          </span>
        </div>
        <div className="mc-data-cell">
          <span className="mc-data-label">Repay due</span>
          <span className={`mc-data-val${row.funding.funded ? '' : ' mc-data-val--muted'}`}>
            {row.funding.funded ? Number(formatUnits(row.requiredRepayment, 18)).toLocaleString() : '—'}
          </span>
        </div>
      </div>

      {/* Lifecycle progress bar */}
      <div>
        <div className="mc-bar-wrap">
          <div className="mc-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="mc-bar-caption" style={{ marginTop: '0.35rem' }}>{caption}</div>
      </div>

      {/* Challenge window alert */}
      {row.status === 'Evidence Submitted - Challenge Window Open' && (
        <div className="vf-alert vf-alert-info" style={{ fontSize: '0.82rem' }}>
          Challenge window: {Number(challengeWindow)}s. {countdownSec > 0
            ? `Time remaining: ${formatCountdown(countdownSec)}`
            : 'Challenge window elapsed; settlement can proceed if undisputed.'}
        </div>
      )}

      {/* Submit evidence */}
      {canSubmitEvidence && (
        <>
          <div className="mc-action-sep" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div className="vf-field">
              <label>Repayment Evidence Hash / Note</label>
              <input
                className="vf-input"
                placeholder="0x… (bytes32) or plain-text note"
                value={evidenceInput}
                onChange={(e) => setEvidenceInput(e.target.value)}
                disabled={actionState !== 'idle'}
              />
            </div>
            <button
              className="vf-btn vf-btn-primary dash-btn-cta"
              onClick={handleSubmitEvidence}
              disabled={!evidenceInput.trim() || actionState !== 'idle'}
            >
              {actionState === 'submitting-evidence' ? 'Submitting evidence…' : 'Submit Repayment Evidence'}
            </button>
          </div>
        </>
      )}

      {/* Deposit repayment */}
      {canDepositRepayment && (
        <>
          <div className="mc-action-sep" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div className="vf-alert vf-alert-info" style={{ fontSize: '0.82rem' }}>
              You must repay {formatUnits(row.requiredRepayment, 18)} mUSD ({formatUnits(row.funding.fundedAmount, 18)} principal + {formatUnits(row.yieldAmount, 18)} yield).
            </div>
            {insufficientBalance && (
              <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem' }}>
                Insufficient mUSD balance. You have {formatUnits(userBalance, 18)} but need {formatUnits(row.requiredRepayment, 18)} mUSD.
              </div>
            )}
            <button
              className="vf-btn vf-btn-primary dash-btn-cta"
              onClick={handleApproveAndDeposit}
              disabled={insufficientBalance || actionState !== 'idle'}
            >
              {actionState === 'approving' ? 'Approving mUSD…'
                : actionState === 'depositing' ? 'Depositing repayment…'
                : 'Approve mUSD & Deposit Repayment'}
            </button>
          </div>
        </>
      )}

      {/* Finalize settlement */}
      {row.funding.repaymentDeposited && (row.status as string) !== 'Repaid & Closed' && (
        <>
          <div className="mc-action-sep" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div className="vf-alert vf-alert-success" style={{ fontSize: '0.82rem' }}>
              Repayment deposited on-chain. Awaiting distribution and collateral release.
            </div>
            {canFinalizeSettlement && (
              <>
                {!challengeWindowElapsed && (
                  <div className="vf-alert vf-alert-info" style={{ fontSize: '0.8rem' }}>
                    Finalization unlocks after challenge window. Time remaining: {formatCountdown(countdownSec)}
                  </div>
                )}
                <button
                  className="vf-btn vf-btn-primary dash-btn-cta"
                  onClick={handleFinalizeSettlement}
                  disabled={!challengeWindowElapsed || actionState !== 'idle'}
                >
                  {actionState === 'finalizing-distribution' ? 'Distributing to investor…'
                    : actionState === 'finalizing-release' ? 'Releasing collateral…'
                    : 'Finalize Settlement'}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Tx / done / error */}
      {txHash && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>
          Tx: <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0, 20)}…</a>
        </div>
      )}
      {actionState === 'done' && (
        <div className="vf-alert vf-alert-success">Confirmed on-chain. Refresh to load updated status.</div>
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

  const parsedClaims = useMemo((): ParsedClaimsResult => {
    if (!address || !claimsData || !collateralData || !fundingData) {
      return { rows: [], decodeIssue: null };
    }

    const caller = address.toLowerCase();
    const rows: MyClaimRow[] = [];
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

    return { rows: rows.reverse(), decodeIssue };
  }, [address, claimsData, collateralData, fundingData, totalClaims, challengeWindow]);

  const myClaims = parsedClaims.rows;

  useEffect(() => {
    setDecodeError(parsedClaims.decodeIssue);
  }, [parsedClaims.decodeIssue]);

  useEffect(() => {
    if (!decodeError) return;

    console.warn('[MyClaims] decode warning', {
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
        <p>Connect your wallet to view your claims.</p>
      </div>
    );
  }

  return (
    <div className="vf-page">
      <div className="vf-dashboard-content">
      <div className="lc-wrap" style={{ maxWidth: '680px' }}>

        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--heading)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>My claims</h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: 'var(--text)' }}>Track each claim from collateral to final settlement.</p>
        </div>

        {isLoading && <div className="vf-alert vf-alert-info">Loading your claims from chain…</div>}

        {decodeError && (
          <div className="vf-alert vf-alert-error" style={{ fontSize: '0.82rem', wordBreak: 'break-word' }}>
            Decode warning on claim #{decodeError.claimId} ({decodeError.source}): {decodeError.message}. Check console for raw payload.
          </div>
        )}

        {!isLoading && myClaims.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text)', fontSize: '0.9rem', margin: 0 }}>
            You have not minted any claims yet. Start from <strong>List a Claim</strong>.
          </p>
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
      </div>
    </div>
  );
}
