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
import ArbitratorMultisigABI from '../config/abis/ArbitratorMultisig.json';

const NFT_ADDR = CONTRACTS.VeriflowClaimNFT as `0x${string}`;
const VAULT_ADDR = CONTRACTS.VeriflowClaimVault as `0x${string}`;
const ARB_ADDR = CONTRACTS.ArbitratorMultisig as `0x${string}`;

const CLAIM_TYPE_LABELS = ['Invoice', 'Royalty', 'Rental'] as const;

type DecodeSource =
  | 'owners'
  | 'claims'
  | 'collateral'
  | 'funding'
  | 'resolution'
  | 'hasVoted';

interface DecodeIssue {
  source: DecodeSource;
  claimId: number;
  message: string;
  raw: unknown;
}

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

interface ResolutionData {
  approvals: bigint;
  rejections: bigint;
  resolved: boolean;
}

interface DisputeRow {
  id: bigint;
  claim: ClaimData;
  collateral: CollateralData;
  funding: FundingData;
  resolution: ResolutionData;
}

interface ParsedDisputesResult {
  rows: DisputeRow[];
  decodeIssue: DecodeIssue | null;
}

interface ParsedHasVotedResult {
  byClaimId: Map<string, boolean>;
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

function normalizeResolutionData(raw: unknown): ResolutionData {
  if (!raw) throw new Error('Missing claimResolutions() result');
  if (Array.isArray(raw)) {
    if (raw.length < 3) throw new Error('claimResolutions() tuple length mismatch');
    return {
      approvals: asBigInt(raw[0], 'claimResolutions.approvals'),
      rejections: asBigInt(raw[1], 'claimResolutions.rejections'),
      resolved: asBoolean(raw[2], 'claimResolutions.resolved'),
    };
  }

  if (!hasKey(raw, 'approvals') || !hasKey(raw, 'rejections') || !hasKey(raw, 'resolved')) {
    throw new Error('Unrecognized claimResolutions() return shape');
  }

  const resolution = raw as Record<string, unknown>;
  return {
    approvals: asBigInt(resolution.approvals, 'claimResolutions.approvals'),
    rejections: asBigInt(resolution.rejections, 'claimResolutions.rejections'),
    resolved: asBoolean(resolution.resolved, 'claimResolutions.resolved'),
  };
}

function normalizeBool(raw: unknown, field: string): boolean {
  if (typeof raw === 'boolean') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'boolean') return raw[0];
  if (raw && typeof raw === 'object' && hasKey(raw, field)) {
    return asBoolean((raw as Record<string, unknown>)[field], `bool.${field}`);
  }
  throw new Error(`Invalid boolean result for ${field}`);
}

function formatAmt(value: bigint): string {
  const num = Number(formatUnits(value, 18));
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}


function DisputeCard({
  row,
  isArbitrator,
  hasVoted,
  onRefresh,
}: {
  row: DisputeRow;
  isArbitrator: boolean;
  hasVoted: boolean | null;
  onRefresh: () => Promise<void>;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [actionState, setActionState] = useState<
    'idle' |
    'voting-approve' |
    'voting-reject' |
    'executing-approve' |
    'executing-reject' |
    'done'
  >('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState('');
  const [localApprovals, setLocalApprovals] = useState<bigint>(row.resolution.approvals);
  const [localRejections, setLocalRejections] = useState<bigint>(row.resolution.rejections);
  const [localResolved, setLocalResolved] = useState<boolean>(row.resolution.resolved);
  const [localHasVoted, setLocalHasVoted] = useState<boolean | null>(hasVoted);
  // Tracks which direction the current session vote went (null = voted before page load).
  const [localVotedDirection, setLocalVotedDirection] = useState<boolean | null>(null);

  useEffect(() => {
    setLocalApprovals(row.resolution.approvals);
    setLocalRejections(row.resolution.rejections);
    setLocalResolved(row.resolution.resolved);
  }, [row.id, row.resolution.approvals, row.resolution.rejections, row.resolution.resolved]);

  useEffect(() => {
    setLocalHasVoted(hasVoted);
  }, [row.id, hasVoted]);

  const quorum = 2n;
  const _approvalsToQuorum = localApprovals >= quorum ? 0n : quorum - localApprovals;
  const _rejectionsToQuorum = localRejections >= quorum ? 0n : quorum - localRejections;
  void _approvalsToQuorum; void _rejectionsToQuorum;
  const approveReachedQuorum = localApprovals >= quorum;
  const rejectReachedQuorum = localRejections >= quorum;
  const canExecute = !localResolved && (approveReachedQuorum || rejectReachedQuorum);
  const executeApprovedSide = approveReachedQuorum;
  const canVote =
    isArbitrator &&
    !localResolved &&
    localHasVoted === false &&
    actionState === 'idle';

  async function handleVote(approved: boolean) {
    setError('');
    setTxHash(null);

    if (!isArbitrator) {
      setError('Connected wallet is not an arbitrator.');
      return;
    }

    if (localHasVoted !== false) {
      setError('You already voted on this dispute or vote status is still loading.');
      return;
    }

    if (localResolved) {
      setError('This dispute has already been resolved.');
      return;
    }

    try {
      setActionState(approved ? 'voting-approve' : 'voting-reject');
      const hash = await writeContractAsync({
        address: ARB_ADDR,
        abi: ArbitratorMultisigABI,
        functionName: 'voteDispute',
        args: [row.id, approved],
      });
      setTxHash(hash);
      await publicClient!.waitForTransactionReceipt({ hash });

      // Optimistic local updates so arbitrators immediately see vote state and quorum progress.
      setLocalHasVoted(true);
      setLocalVotedDirection(approved);
      if (approved) {
        setLocalApprovals((prev) => prev + 1n);
      } else {
        setLocalRejections((prev) => prev + 1n);
      }

      await onRefresh();
      setActionState('done');
    } catch (e: unknown) {
      setActionState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleResolve(approved: boolean) {
    setError('');
    setTxHash(null);

    if (!isArbitrator) {
      setError('Connected wallet is not an arbitrator.');
      return;
    }

    if (localResolved) {
      setError('This dispute has already been resolved.');
      return;
    }

    if (approved && localApprovals < quorum) {
      setError(`Approve quorum not reached yet (${localApprovals.toString()}/2).`);
      return;
    }

    if (!approved && localRejections < quorum) {
      setError(`Reject quorum not reached yet (${localRejections.toString()}/2).`);
      return;
    }

    try {
      setActionState(approved ? 'executing-approve' : 'executing-reject');
      const hash = await writeContractAsync({
        address: ARB_ADDR,
        abi: ArbitratorMultisigABI,
        functionName: 'resolveDispute',
        args: [row.id, approved],
      });
      setTxHash(hash);
      await publicClient!.waitForTransactionReceipt({ hash });
      setLocalResolved(true);
      await onRefresh();
      setActionState('done');
    } catch (e: unknown) {
      setActionState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Derived presentation values ────────────────────────────────────────────
  const cardBorderColor = localResolved
    ? 'rgba(46,230,197,0.35)'
    : canExecute
      ? (executeApprovedSide ? 'rgba(34,197,94,0.55)' : 'rgba(239,83,80,0.65)')
      : 'rgba(239,83,80,0.45)';
  const cardGlow = localResolved
    ? 'rgba(46,230,197,0.12)'
    : canExecute
      ? (executeApprovedSide ? 'rgba(34,197,94,0.16)' : 'rgba(239,83,80,0.18)')
      : 'rgba(239,83,80,0.14)';

  const TYPE_CHIP = [
    { icon: '📄', bg: 'rgba(124,92,255,0.15)',  border: 'rgba(124,92,255,0.3)'  },
    { icon: '🎵', bg: 'rgba(46,230,197,0.12)',  border: 'rgba(46,230,197,0.25)' },
    { icon: '🏠', bg: 'rgba(245,182,92,0.12)',  border: 'rgba(245,182,92,0.25)' },
  ] as const;
  const chip = TYPE_CHIP[row.claim.claimType as 0 | 1 | 2] ?? { icon: '📄', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };

  const pillStyle = localResolved
    ? { background: 'rgba(46,230,197,0.12)',  color: '#2ee6c5', borderColor: 'rgba(46,230,197,0.3)'  }
    : canExecute
      ? (executeApprovedSide
          ? { background: 'rgba(34,197,94,0.12)',  color: '#4ade80', borderColor: 'rgba(34,197,94,0.4)'  }
          : { background: 'rgba(239,83,80,0.12)',   color: '#ef9090', borderColor: 'rgba(239,83,80,0.4)'  })
      : { background: 'rgba(239,83,80,0.14)',       color: '#ef5350', borderColor: 'rgba(239,83,80,0.45)' };
  const pillLabel = localResolved ? 'Resolved' : canExecute ? 'Ready to execute' : 'Disputed';

  const cardMeta = canExecute
    ? `Quorum reached · ${executeApprovedSide ? 'approve' : 'reject'}`
    : `Originator ${row.claim.originator.slice(0, 6)}...${row.claim.originator.slice(-4)} · Investor ${row.funding.investor.slice(0, 6)}...${row.funding.investor.slice(-4)}`;

  return (
    <div
      className="ap-dispute-card"
      style={{ borderColor: cardBorderColor, boxShadow: `0 0 0 1px ${cardBorderColor}, 0 18px 32px -24px ${cardGlow}` }}
    >
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="ap-card-header">
        <div className="ap-identity-block">
          <span className="ap-icon-chip" style={{ background: chip.bg, border: `1px solid ${chip.border}` }}>
            {chip.icon}
          </span>
          <div className="ap-copy-block">
            <span className="ap-claim-name">
              {CLAIM_TYPE_LABELS[row.claim.claimType] ?? 'Unknown'} #{row.id.toString()}
            </span>
            <span className="ap-card-meta">{cardMeta}</span>
          </div>
        </div>
        <span className="ap-status-pill" style={pillStyle}>{pillLabel}</span>
      </div>

      {/* ── Data grid (active disputes only) ──────────────────────── */}
      {!canExecute && !localResolved && (
        <div className="ap-data-grid">
          <div className="ap-stat-block">
            <span className="ap-stat-label">Claim value</span>
            <span className="ap-stat-value">{formatAmt(row.claim.amount)} mUSD</span>
          </div>
          <div className="ap-stat-block">
            <span className="ap-stat-label">Funded</span>
            <span className="ap-stat-value">{formatAmt(row.funding.fundedAmount)} mUSD</span>
          </div>
          <div className="ap-stat-block">
            <span className="ap-stat-label">Collateral at stake</span>
            <span className="ap-stat-value">{formatAmt(row.collateral.amount)} mUSD</span>
          </div>
        </div>
      )}

      {/* ── Quorum module ─────────────────────────────────────────── */}
      {!localResolved && (
        <div className="ap-quorum-module">
          <span className="ap-quorum-label">Quorum · 2 of 3 required</span>

          <div className="ap-quorum-row">
            <span className="ap-quorum-row-label" style={{ color: '#4ade80' }}>Approve</span>
            <div className="ap-quorum-bar">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className={`ap-quorum-segment ${
                    i < Number(localApprovals) ? 'ap-quorum-segment--approve' : 'ap-quorum-segment--empty'
                  }`}
                />
              ))}
            </div>
            <span className="ap-quorum-tally">{localApprovals.toString()} / 2</span>
          </div>

          <div className="ap-quorum-row">
            <span className="ap-quorum-row-label" style={{ color: '#ef9090' }}>Reject</span>
            <div className="ap-quorum-bar">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className={`ap-quorum-segment ${
                    i < Number(localRejections) ? 'ap-quorum-segment--reject' : 'ap-quorum-segment--empty'
                  }`}
                />
              ))}
            </div>
            <span className="ap-quorum-tally">{localRejections.toString()} / 2</span>
          </div>
        </div>
      )}

      {/* ── Resolved banner ───────────────────────────────────────── */}
      {localResolved && (
        <div className="ap-resolved-banner">This dispute has been resolved.</div>
      )}

      {/* ── Vote / execute controls ───────────────────────────────── */}
      {!localResolved && (
        isArbitrator ? (
          <>
            {/* Already-voted label (shown when quorum not yet reached) */}
            {localHasVoted === true && !canExecute && (
              <span
                className="ap-voted-label"
                style={{
                  color: localVotedDirection === true
                    ? '#4ade80'
                    : localVotedDirection === false
                      ? '#ef9090'
                      : 'var(--text)',
                }}
              >
                {localVotedDirection === true
                  ? 'You voted Approve'
                  : localVotedDirection === false
                    ? 'You voted Reject'
                    : 'You have already voted on this claim.'}
              </span>
            )}

            {/* Vote buttons — only before quorum, only if not yet voted */}
            {canVote && !canExecute && (
              <div className="ap-vote-row">
                <button
                  className="ap-vote-btn ap-vote-btn--approve"
                  onClick={() => handleVote(true)}
                  disabled={actionState !== 'idle'}
                >
                  {(actionState as string) === 'voting-approve' ? 'Voting…' : 'Vote approve'}
                </button>
                <button
                  className="ap-vote-btn ap-vote-btn--reject"
                  onClick={() => handleVote(false)}
                  disabled={actionState !== 'idle'}
                >
                  {(actionState as string) === 'voting-reject' ? 'Voting…' : 'Vote reject'}
                </button>
              </div>
            )}

            {/* Execute button — prominent CTA once quorum reached */}
            {canExecute && (
              <button
                className={`ap-execute-btn ${
                  executeApprovedSide ? 'ap-execute-btn--approve' : 'ap-execute-btn--reject'
                }`}
                onClick={() => handleResolve(executeApprovedSide)}
                disabled={actionState !== 'idle'}
              >
                {actionState === 'executing-approve' || actionState === 'executing-reject'
                  ? 'Executing…'
                  : executeApprovedSide
                    ? 'Execute resolution · release funds'
                    : 'Execute resolution · slash collateral'}
              </button>
            )}
          </>
        ) : (
          <div className="ap-warn-banner">
            Connected wallet is not one of the 3 configured arbitrators. Resolve controls are hidden.
          </div>
        )
      )}

      {/* ── Tx feedback ───────────────────────────────────────────── */}
      {txHash && (
        <div className="vf-alert vf-alert-success">
          Tx submitted:{' '}
          <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">
            {txHash}
          </a>
        </div>
      )}

      {actionState === 'done' && (
        <div className="vf-alert vf-alert-success">Confirmed on-chain and refreshed.</div>
      )}

      {error && (
        <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default function ArbitratorPanel() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | Arbitrator Panel';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi arbitrator panel for reviewing active disputes and resolving with multisig quorum.');

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

  const { data: ownersRaw, isLoading: loadingOwners } = useReadContract({
    address: ARB_ADDR,
    abi: ArbitratorMultisigABI,
    functionName: 'ownersList',
  });

  const totalClaims = totalRaw as bigint ?? 0n;

  const ownersList = useMemo((): string[] => {
    if (!ownersRaw) return [];
    if (Array.isArray(ownersRaw) && ownersRaw.every((x) => typeof x === 'string')) {
      return ownersRaw as string[];
    }
    throw new Error('Unrecognized ownersList() return shape');
  }, [ownersRaw]);

  const isArbitrator = !!address && ownersList.some((owner) => owner.toLowerCase() === address.toLowerCase());

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

  const resolutionContracts = useMemo(() =>
    Array.from({ length: Number(totalClaims) }, (_, i) => ({
      address: ARB_ADDR,
      abi: ArbitratorMultisigABI as any,
      functionName: 'claimResolutions',
      args: [BigInt(i)],
    })), [totalClaims]);

  const { data: claimsData, isLoading: loadingClaims, refetch: refetchClaims } = useReadContracts({
    contracts: claimContracts,
    query: { enabled: totalClaims > 0n },
  });

  const { data: collateralData, isLoading: loadingCollateral, refetch: refetchCollateral } = useReadContracts({
    contracts: collateralContracts,
    query: { enabled: totalClaims > 0n },
  });

  const { data: fundingData, isLoading: loadingFunding, refetch: refetchFunding } = useReadContracts({
    contracts: fundingContracts,
    query: { enabled: totalClaims > 0n },
  });

  const { data: resolutionData, isLoading: loadingResolution, refetch: refetchResolution } = useReadContracts({
    contracts: resolutionContracts,
    query: { enabled: totalClaims > 0n },
  });

  const parsedDisputes = useMemo((): ParsedDisputesResult => {
    if (!claimsData || !collateralData || !fundingData || !resolutionData) {
      return { rows: [], decodeIssue: null };
    }

    const rows: DisputeRow[] = [];
    let decodeIssue: DecodeIssue | null = null;

    for (let i = 0; i < Number(totalClaims); i++) {
      let claim: ClaimData;
      let collateral: CollateralData;
      let funding: FundingData;
      let resolution: ResolutionData;

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

      try {
        resolution = normalizeResolutionData(resolutionData[i]?.result);
      } catch (error: unknown) {
        decodeIssue ??= {
          source: 'resolution',
          claimId: i,
          message: error instanceof Error ? error.message : String(error),
          raw: resolutionData[i]?.result,
        };
        continue;
      }

      if (!funding.disputed) continue;

      rows.push({
        id: BigInt(i),
        claim,
        collateral,
        funding,
        resolution,
      });
    }

    return { rows: rows.reverse(), decodeIssue };
  }, [claimsData, collateralData, fundingData, resolutionData, totalClaims]);

  const disputes = parsedDisputes.rows;

  const hasVotedContracts = useMemo(() => {
    if (!address || disputes.length === 0) return [];
    return disputes.map((row) => ({
      address: ARB_ADDR,
      abi: ArbitratorMultisigABI as any,
      functionName: 'hasVoted',
      args: [row.id, address as `0x${string}`],
    }));
  }, [address, disputes]);

  const { data: hasVotedData, isLoading: loadingHasVoted, refetch: refetchHasVoted } = useReadContracts({
    contracts: hasVotedContracts,
    query: { enabled: !!address && disputes.length > 0 },
  });

  const parsedHasVoted = useMemo((): ParsedHasVotedResult => {
    const byClaimId = new Map<string, boolean>();
    let decodeIssue: DecodeIssue | null = null;

    if (!hasVotedData) {
      return { byClaimId, decodeIssue };
    }

    for (let i = 0; i < disputes.length; i++) {
      try {
        const voted = normalizeBool(hasVotedData[i]?.result, 'hasVoted');
        byClaimId.set(disputes[i].id.toString(), voted);
      } catch (error: unknown) {
        decodeIssue ??= {
          source: 'hasVoted',
          claimId: Number(disputes[i].id),
          message: error instanceof Error ? error.message : String(error),
          raw: hasVotedData[i]?.result,
        };
      }
    }

    return { byClaimId, decodeIssue };
  }, [hasVotedData, disputes]);

  useEffect(() => {
    setDecodeError(parsedDisputes.decodeIssue ?? parsedHasVoted.decodeIssue);
  }, [parsedDisputes.decodeIssue, parsedHasVoted.decodeIssue]);

  useEffect(() => {
    if (!decodeError) return;

    console.warn('[ArbitratorPanel] decode warning', {
      source: decodeError.source,
      claimId: decodeError.claimId,
      message: decodeError.message,
      raw: decodeError.raw,
    });
  }, [decodeError]);

  const isLoading =
    loadingTotal ||
    loadingOwners ||
    loadingClaims ||
    loadingCollateral ||
    loadingFunding ||
    loadingResolution ||
    loadingHasVoted;

  async function refreshDisputeState() {
    await Promise.all([
      refetchClaims(),
      refetchCollateral(),
      refetchFunding(),
      refetchResolution(),
      refetchHasVoted(),
    ]);
  }

  if (!isConnected) {
    return (
      <div className="vf-connect-wall">
        <p>Connect your wallet to access the Arbitrator Panel.</p>
      </div>
    );
  }

  return (
    <div className="vf-page">
      <div className="vf-dashboard-content">
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--heading)', fontSize: '1.38rem', fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>Arbitrator panel</h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: 'var(--text)' }}>Review disputed claims and cast your resolution vote.</p>
        </div>

        {isLoading && (
          <div className="vf-alert vf-alert-info">Loading dispute state from chain...</div>
        )}

        {decodeError && (
          <div className="vf-alert vf-alert-error" style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
            Decode warning on claim #{decodeError.claimId} ({decodeError.source}): {decodeError.message}. Check console for raw payload.
          </div>
        )}

        {!isLoading && disputes.length === 0 && (
          <p style={{ color: 'var(--text)', textAlign: 'center', padding: '2rem 0', margin: 0 }}>
            No active disputes at the moment.
          </p>
        )}

        {disputes.map((row) => (
          <DisputeCard
            key={row.id.toString()}
            row={row}
            isArbitrator={isArbitrator}
            hasVoted={parsedHasVoted.byClaimId.has(row.id.toString()) ? parsedHasVoted.byClaimId.get(row.id.toString())! : null}
            onRefresh={refreshDisputeState}
          />
        ))}
      </div>
    </div>
  );
}
