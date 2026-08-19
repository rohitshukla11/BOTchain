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

function statusBadge(resolution: ResolutionData): string {
  if (resolution.resolved) return 'vf-badge-green';
  if (resolution.approvals >= 2n || resolution.rejections >= 2n) return 'vf-badge-yellow';
  return 'vf-badge-red';
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

  useEffect(() => {
    setLocalApprovals(row.resolution.approvals);
    setLocalRejections(row.resolution.rejections);
    setLocalResolved(row.resolution.resolved);
  }, [row.id, row.resolution.approvals, row.resolution.rejections, row.resolution.resolved]);

  useEffect(() => {
    setLocalHasVoted(hasVoted);
  }, [row.id, hasVoted]);

  const quorum = 2n;
  const approvalsToQuorum = localApprovals >= quorum ? 0n : quorum - localApprovals;
  const rejectionsToQuorum = localRejections >= quorum ? 0n : quorum - localRejections;
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

  return (
    <div className="vf-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-h)', fontFamily: 'var(--mono)', fontSize: '0.9rem' }}>
            #{row.id.toString()}
          </span>
          <span className="vf-badge vf-badge-purple">{CLAIM_TYPE_LABELS[row.claim.claimType] ?? 'Unknown'}</span>
          <span className={`vf-badge ${statusBadge(row.resolution)}`}>
            {row.resolution.resolved ? 'Resolved' : 'Active Dispute'}
          </span>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>
          Due {new Date(Number(row.claim.dueDate) * 1000).toLocaleDateString()}
        </span>
      </div>

      <div className="vf-stats">
        <div className="vf-stat">
          <span className="vf-stat-label">Claim Amount</span>
          <span className="vf-stat-value">{formatUnits(row.claim.amount, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Funded Amount</span>
          <span className="vf-stat-value">{formatUnits(row.funding.fundedAmount, 18)} mUSD</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Collateral Locked</span>
          <span className="vf-stat-value">{row.collateral.locked ? 'Yes' : 'No'}</span>
        </div>
        <div className="vf-stat">
          <span className="vf-stat-label">Repayment Deposited</span>
          <span className="vf-stat-value">{row.funding.repaymentDeposited ? 'Yes' : 'No'}</span>
        </div>
      </div>

      <div className="vf-alert vf-alert-info" style={{ fontSize: '0.85rem' }}>
        Quorum: 2-of-3. Approvals: {localApprovals.toString()}/2 needed ({approvalsToQuorum.toString()} remaining). Rejections: {localRejections.toString()}/2 needed ({rejectionsToQuorum.toString()} remaining).
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text)', display: 'grid', gap: '0.25rem' }}>
        <div>Investor: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-h)' }}>{row.funding.investor.slice(0, 10)}...{row.funding.investor.slice(-6)}</span></div>
        <div>Originator: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-h)' }}>{row.claim.originator.slice(0, 10)}...{row.claim.originator.slice(-6)}</span></div>
        <div>Dispute evidence: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-h)' }}>{row.funding.disputeEvidenceHash}</span></div>
      </div>

      {isArbitrator ? (
        <>
          <div className={localHasVoted ? 'vf-alert vf-alert-yellow' : 'vf-alert vf-alert-info'} style={{ fontSize: '0.85rem' }}>
            {localHasVoted === null
              ? 'Checking your vote status...'
              : localHasVoted
                ? 'You have already voted on this claim.'
                : 'You have not voted on this claim yet.'}
          </div>

          {localResolved ? (
            <div className="vf-alert vf-alert-success" style={{ fontSize: '0.85rem' }}>
              This dispute has been resolved.
            </div>
          ) : (
            <>
              {localHasVoted === false && (
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button
                    className="vf-btn vf-btn-primary"
                    onClick={() => handleVote(true)}
                    disabled={!canVote}
                  >
                    {actionState === 'voting-approve' ? 'Voting Approve...' : 'Vote Approve'}
                  </button>
                  <button
                    className="vf-btn vf-btn-secondary"
                    onClick={() => handleVote(false)}
                    disabled={!canVote}
                  >
                    {actionState === 'voting-reject' ? 'Voting Reject...' : 'Vote Reject'}
                  </button>
                </div>
              )}

              {canExecute && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div className="vf-alert vf-alert-yellow" style={{ fontSize: '0.85rem' }}>
                    Quorum reached on the {executeApprovedSide ? 'approve' : 'reject'} side. Execute resolution now.
                  </div>
                  <button
                    className="vf-btn vf-btn-primary"
                    onClick={() => handleResolve(executeApprovedSide)}
                    disabled={actionState !== 'idle'}
                  >
                    {executeApprovedSide
                      ? (actionState === 'executing-approve' ? 'Executing Approve Resolution...' : 'Execute Resolution (Approve)')
                      : (actionState === 'executing-reject' ? 'Executing Reject Resolution...' : 'Execute Resolution (Reject)')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="vf-alert vf-alert-yellow" style={{ fontSize: '0.85rem' }}>
          Connected wallet is not one of the 3 configured arbitrators. Resolve controls are hidden.
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
      <h2>Arbitrator Panel</h2>
      <p className="sub">Review active disputes, inspect quorum progress, and resolve claims once 2-of-3 consensus is reached.</p>

      <div className="vf-card" style={{ gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Configured Arbitrators</h3>
        {ownersList.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text)' }}>No arbitrator owners returned from chain.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
            {ownersList.map((owner) => (
              <li key={owner} style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', color: 'var(--text-h)' }}>
                {owner}
              </li>
            ))}
          </ul>
        )}
        <div className={isArbitrator ? 'vf-alert vf-alert-success' : 'vf-alert vf-alert-yellow'} style={{ fontSize: '0.85rem' }}>
          {isArbitrator
            ? 'Connected wallet is an arbitrator. Resolve controls are enabled.'
            : 'Connected wallet is not an arbitrator. Resolve controls are hidden.'}
        </div>
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
        <div className="vf-card">
          <p style={{ margin: 0, color: 'var(--text)', textAlign: 'center', padding: '1rem 0' }}>
            No active disputes at the moment.
          </p>
        </div>
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
  );
}
