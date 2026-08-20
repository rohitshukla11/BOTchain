import { useEffect, useState, useMemo } from 'react';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { CONTRACTS } from '../config/contracts.ts';
import VeriflowClaimNFTABI   from '../config/abis/VeriflowClaimNFT.json';
import VeriflowClaimVaultABI from '../config/abis/VeriflowClaimVault.json';
import MockStablecoinABI     from '../config/abis/MockStablecoin.json';
import RiskOracleABI         from '../config/abis/RiskOracle.json';

const NFT_ADDR   = CONTRACTS.VeriflowClaimNFT   as `0x${string}`;
const VAULT_ADDR = CONTRACTS.VeriflowClaimVault as `0x${string}`;
const TOKEN_ADDR = CONTRACTS.MockStablecoin     as `0x${string}`;
const ORACLE_ADDR= CONTRACTS.RiskOracle         as `0x${string}`;

const CLAIM_TYPE_LABELS = ['Invoice', 'Royalty', 'Rental'] as const;
// const CLAIM_TYPE_BADGE  = ['vf-badge-purple', 'vf-badge-green', 'vf-badge-yellow'] as const;
const COLLATERAL_RATIO  = ['10%', '15%', '20%'] as const;

// ── Types ──────────────────────────────────────────────────────────────────

interface ClaimInfo {
  id: bigint;
  claimType: number;
  amount: bigint;
  dueDate: bigint;
  originator: string;
  collateralAmount: bigint;
  maxFundingAmount: bigint;
  requiredCollateral: bigint;
}

interface ClaimData {
  claimType: number;
  amount: bigint;
  dueDate: bigint;
  originator: string;
}

interface CollateralData {
  amount: bigint;
  locked: boolean;
}

interface FundingData {
  funded: boolean;
}

interface DecodeIssue {
  source: 'claims' | 'collateral' | 'funding';
  claimId: number;
  message: string;
  raw: unknown;
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

function normalizeClaimData(raw: unknown): ClaimData {
  if (!raw) throw new Error('Missing claims() result');
  if (Array.isArray(raw)) {
    if (raw.length < 5) throw new Error('claims() tuple length mismatch');
    return {
      claimType: Number(raw[0]),
      amount: asBigInt(raw[1], 'claims.amount'),
      dueDate: asBigInt(raw[2], 'claims.dueDate'),
      originator: asAddress(raw[4], 'claims.originator'),
    };
  }

  if (!hasKey(raw, 'claimType') || !hasKey(raw, 'amount') || !hasKey(raw, 'dueDate') || !hasKey(raw, 'originator')) {
    throw new Error('Unrecognized claims() return shape');
  }

  const claim = raw as Record<string, unknown>;
  return {
    claimType: Number(claim.claimType),
    amount: asBigInt(claim.amount, 'claims.amount'),
    dueDate: asBigInt(claim.dueDate, 'claims.dueDate'),
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
    if (raw.length < 3) throw new Error('funding() tuple length mismatch');
    return {
      funded: asBoolean(raw[2], 'funding.funded'),
    };
  }

  if (!hasKey(raw, 'funded')) {
    throw new Error('Unrecognized funding() return shape');
  }

  const funding = raw as Record<string, unknown>;
  return {
    funded: asBoolean(funding.funded, 'funding.funded'),
  };
}

// ── ClaimCard ──────────────────────────────────────────────────────────────

function ClaimCard({ claim, userAddress }: { claim: ClaimInfo; userAddress: string }) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [amountStr, setAmountStr] = useState(formatUnits(claim.maxFundingAmount, 18));
  const [fundingStep, setFundingStep] = useState<'idle' | 'approving' | 'funding' | 'funded'>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState('');

  // User mUSD balance
  const { data: balanceRaw } = useReadContract({
    address: TOKEN_ADDR,
    abi: MockStablecoinABI,
    functionName: 'balanceOf',
    args: [userAddress as `0x${string}`],
    query: { enabled: !!userAddress },
  });
  const userBalance = balanceRaw as bigint ?? 0n;

  const inputAmount = useMemo(() => {
    try { return amountStr ? parseUnits(amountStr, 18) : 0n; } catch { return 0n; }
  }, [amountStr]);

  const aboveCapError  = inputAmount > claim.maxFundingAmount;
  const insufficientBalance = inputAmount > userBalance;
  const canFund = inputAmount > 0n && !aboveCapError && !insufficientBalance && fundingStep === 'idle';

  const _dueDateStr = new Date(Number(claim.dueDate) * 1000).toLocaleDateString(); void _dueDateStr;

  async function handleApproveAndFund() {
    setError('');
    setTxHash(null);
    try {
      // 1. Approve vault to spend mUSD
      setFundingStep('approving');
      const approveHash = await writeContractAsync({
        address: TOKEN_ADDR,
        abi: MockStablecoinABI,
        functionName: 'approve',
        args: [VAULT_ADDR, inputAmount],
      });
      setTxHash(approveHash);
      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      // 2. Fund the claim
      setFundingStep('funding');
      const fundHash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: VeriflowClaimVaultABI,
        functionName: 'fundClaim',
        args: [claim.id, inputAmount],
      });
      setTxHash(fundHash);
      await publicClient!.waitForTransactionReceipt({ hash: fundHash });

      setFundingStep('funded');
    } catch (e: unknown) {
      setFundingStep('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (fundingStep === 'funded') {
    return (
      <div className="vf-alert vf-alert-success" style={{ textAlign: 'center', padding: '1.25rem' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>✓ Claim #{claim.id.toString()} funded</div>
        <div style={{ fontSize: '0.85rem' }}>
          You funded <strong>{formatUnits(inputAmount, 18)} mUSD</strong>.
          {txHash && (
            <> <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">View tx ↗</a></>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Funding amount card */}
      <div className="lc-amount-card">
        <div className="lc-amount-header">
          <span className="lc-amount-label">Funding amount</span>
          <span className="lc-amount-unit">max {formatUnits(claim.maxFundingAmount, 18)} mUSD</span>
        </div>
        <input
          type="number"
          className="lc-amount-input"
          step="any"
          value={amountStr}
          onChange={e => setAmountStr(e.target.value)}
          disabled={fundingStep !== 'idle'}
        />
        <div className="lc-amount-divider" />
        <div className="bf-meta-grid">
          <div className="lc-meta-field">
            <span className="lc-meta-label">Claim value</span>
            <span className="bf-meta-val">{formatUnits(claim.amount, 18)} mUSD</span>
          </div>
          <div className="lc-meta-field">
            <span className="lc-meta-label">Collateral</span>
            <span className="bf-meta-val">{formatUnits(claim.collateralAmount, 18)} mUSD</span>
          </div>
          <div className="lc-meta-field">
            <span className="lc-meta-label">Ratio</span>
            <span className="bf-meta-val">{COLLATERAL_RATIO[claim.claimType]}</span>
          </div>
        </div>
      </div>

      {/* Cap validation errors */}
      {aboveCapError && (
        <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem' }}>
          Amount exceeds funding cap of {formatUnits(claim.maxFundingAmount, 18)} mUSD (claimAmount − collateral).
        </div>
      )}
      {!aboveCapError && insufficientBalance && inputAmount > 0n && (
        <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem' }}>
          Insufficient mUSD balance. You have {formatUnits(userBalance, 18)} mUSD.
        </div>
      )}

      {/* Info strip */}
      <div className="lc-risk-strip">
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚡</span>
        <span className="lc-risk-text">
          Funds are paid <strong style={{ color: 'var(--text-h)' }}>directly to the originator</strong> — your return comes when they repay principal + 10% yield.
        </span>
      </div>

      {/* Balance */}
      <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text)' }}>
        Your balance: {formatUnits(userBalance, 18)} mUSD
      </div>

      {/* CTA */}
      <button
        className="vf-btn vf-btn-primary dash-btn-cta"
        disabled={!canFund}
        onClick={handleApproveAndFund}
      >
        {fundingStep === 'approving' ? '⏳ Approving mUSD…' :
         fundingStep === 'funding'   ? '⏳ Funding claim…'  :
         'Approve mUSD & fund claim'}
      </button>

      {/* Two-step progress */}
      {(fundingStep === 'approving' || fundingStep === 'funding') && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text)' }}>
          <span className={`vf-badge ${fundingStep === 'funding' ? 'vf-badge-green' : 'vf-badge-purple'}`}>
            {fundingStep === 'funding' ? '✓' : '…'} Step 1: Approve
          </span>
          <span>→</span>
          <span className={`vf-badge ${fundingStep === 'funding' ? 'vf-badge-purple' : ''}`} style={{ opacity: fundingStep === 'funding' ? 1 : 0.4 }}>
            {fundingStep === 'funding' ? '…' : ''} Step 2: Fund
          </span>
        </div>
      )}

      {/* Tx hash */}
      {txHash && (fundingStep as string) !== 'funded' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>
          Tx: <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0,20)}…</a>
        </div>
      )}

      {/* Error */}
      {error && <div className="vf-alert vf-alert-error" style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>{error}</div>}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BrowseFund() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | Browse and Fund';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi marketplace for browsing collateralized claims and funding originator working capital.');

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
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 1. Total minted claims
  const { data: totalRaw, isLoading: loadingTotal } = useReadContract({
    address: NFT_ADDR,
    abi: VeriflowClaimNFTABI,
    functionName: 'totalClaims',
  });
  const total = totalRaw as bigint ?? 0n;

  // 2. Batch-read all claims, collateral, and funding state
  const claimContracts = useMemo(() =>
    Array.from({ length: Number(total) }, (_, i) => ({
      address: NFT_ADDR,
      abi: VeriflowClaimNFTABI as any,
      functionName: 'claims',
      args: [BigInt(i)],
    })), [total]);

  const collateralContracts = useMemo(() =>
    Array.from({ length: Number(total) }, (_, i) => ({
      address: NFT_ADDR,
      abi: VeriflowClaimNFTABI as any,
      functionName: 'collateral',
      args: [BigInt(i)],
    })), [total]);

  const fundingContracts = useMemo(() =>
    Array.from({ length: Number(total) }, (_, i) => ({
      address: VAULT_ADDR,
      abi: VeriflowClaimVaultABI as any,
      functionName: 'funding',
      args: [BigInt(i)],
    })), [total]);

  const { data: claimsData,    isLoading: loadingClaims }    = useReadContracts({ contracts: claimContracts,    query: { enabled: total > 0n } });
  const { data: collateralData,isLoading: loadingCollateral } = useReadContracts({ contracts: collateralContracts, query: { enabled: total > 0n } });
  const { data: fundingData,   isLoading: loadingFunding }    = useReadContracts({ contracts: fundingContracts,   query: { enabled: total > 0n } });

  const parsedOpenState = useMemo(() => {
    const claimsById = new Map<number, ClaimData>();
    const collateralById = new Map<number, CollateralData>();
    const openClaimIds: number[] = [];
    let issue: DecodeIssue | null = null;

    if (!claimsData || !collateralData || !fundingData) {
      return { openClaimIds, claimsById, collateralById, decodeIssue: issue };
    }

    for (let i = 0; i < Number(total); i++) {
      let claim: ClaimData;
      let collateral: CollateralData;
      let funding: FundingData;

      try {
        claim = normalizeClaimData(claimsData[i]?.result);
      } catch (error: unknown) {
        issue ??= {
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
        issue ??= {
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
        issue ??= {
          source: 'funding',
          claimId: i,
          message: error instanceof Error ? error.message : String(error),
          raw: fundingData[i]?.result,
        };
        continue;
      }

      claimsById.set(i, claim);
      collateralById.set(i, collateral);

      if (
        collateral.locked === true &&
        funding.funded === false &&
        claim.originator !== '0x0000000000000000000000000000000000000000'
      ) {
        openClaimIds.push(i);
      }
    }

    return { openClaimIds, claimsById, collateralById, decodeIssue: issue };
  }, [claimsData, collateralData, fundingData, total]);

  const openClaimIds = parsedOpenState.openClaimIds;

  useEffect(() => {
    setDecodeError(parsedOpenState.decodeIssue);
  }, [parsedOpenState.decodeIssue]);

  useEffect(() => {
    if (!decodeError) return;

    console.warn('[BrowseFund] decode warning', {
      source: decodeError.source,
      claimId: decodeError.claimId,
      message: decodeError.message,
      raw: decodeError.raw,
    });
  }, [decodeError]);

  const oracleContracts = useMemo(() =>
    openClaimIds.map(i => {
      const c = parsedOpenState.claimsById.get(i);
      return {
        address: ORACLE_ADDR,
        abi: RiskOracleABI as any,
        functionName: 'getRequiredCollateral',
        args: [c?.claimType ?? 0, c?.amount ?? 0n],
      };
    }), [openClaimIds, parsedOpenState.claimsById]);

  const { data: oracleData } = useReadContracts({ contracts: oracleContracts, query: { enabled: openClaimIds.length > 0 } });

  // 4. Build final list of fundable claims
  const fundableClaims = useMemo((): ClaimInfo[] => {
    if (!oracleData) return [];
    return openClaimIds.map((i, idx) => {
      const c = parsedOpenState.claimsById.get(i);
      const col = parsedOpenState.collateralById.get(i);
      const req  = oracleData[idx]?.result as bigint | undefined ?? 0n;
      const max  = (c?.amount ?? 0n) > req ? (c?.amount ?? 0n) - req : 0n;
      return {
        id: BigInt(i),
        claimType: c?.claimType ?? 0,
        amount: c?.amount ?? 0n,
        dueDate: c?.dueDate ?? 0n,
        originator: c?.originator ?? '',
        collateralAmount: col?.amount ?? 0n,
        maxFundingAmount: max,
        requiredCollateral: req,
      };
    });
  }, [openClaimIds, oracleData, parsedOpenState.claimsById, parsedOpenState.collateralById]);

  const isLoading = loadingTotal || loadingClaims || loadingCollateral || loadingFunding;

  // ── Render ─────────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="vf-connect-wall">
        <p>Connect your wallet to browse and fund claims.</p>
      </div>
    );
  }

  const selectedClaim = fundableClaims.find(c => Number(c.id) === selectedId) ?? fundableClaims[0];

  return (
    <div className="vf-page">
      <div className="vf-dashboard-content">
      <div className="lc-wrap" style={{ maxWidth: '560px' }}>

        {/* Heading */}
        <div className="lc-header">
          <h2 className="lc-title">Fund a claim</h2>
          <p className="lc-subtitle">Provide working capital today, earn yield on repayment.</p>
        </div>

        {/* Loading */}
        {isLoading && <div className="vf-alert vf-alert-info">Loading claims from chain…</div>}

        {/* Decode warning */}
        {decodeError && (
          <div className="vf-alert vf-alert-error" style={{ fontSize: '0.82rem', wordBreak: 'break-word' }}>
            Decode warning on claim #{decodeError.claimId} ({decodeError.source}): {decodeError.message}. Check console for raw payload.
          </div>
        )}

        {/* Empty states */}
        {!isLoading && total === 0n && (
          <p style={{ textAlign: 'center', color: 'var(--text)', fontSize: '0.9rem', margin: 0 }}>
            No claims minted yet. Try <strong>List a Claim</strong> first.
          </p>
        )}
        {!isLoading && total > 0n && fundableClaims.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text)', fontSize: '0.9rem', margin: 0 }}>
            No open claims available right now. All claims are either not yet collateralised or already funded.
          </p>
        )}

        {/* Claim selector */}
        {fundableClaims.length > 0 && (
          <div className="bf-selector">
            {fundableClaims.map(claim => {
              const isActive = Number(claim.id) === (selectedId ?? Number(fundableClaims[0].id));
              const due = new Date(Number(claim.dueDate) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const iconCls = claim.claimType === 0 ? 'dash-row-icon--invoice' : claim.claimType === 1 ? 'dash-row-icon--royalty' : 'dash-row-icon--rental';
              const typeIcon = claim.claimType === 0 ? '📄' : claim.claimType === 1 ? '🎵' : '🏠';
              return (
                <button
                  key={claim.id.toString()}
                  type="button"
                  className={`bf-selector-row${isActive ? ' bf-selector-row--active' : ''}`}
                  style={{ opacity: isActive ? 1 : 0.5 }}
                  onClick={() => setSelectedId(Number(claim.id))}
                >
                  <span className={`dash-row-icon ${iconCls}`}>{typeIcon}</span>
                  <div className="bf-row-info">
                    <span className="dash-row-title">{CLAIM_TYPE_LABELS[claim.claimType]} #{claim.id.toString()}</span>
                    <span className="dash-row-sub">Due {due}</span>
                  </div>
                  <span className="vf-badge vf-badge-green">Open</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Funding card for selected claim */}
        {selectedClaim && (
          <ClaimCard
            key={selectedClaim.id.toString()}
            claim={selectedClaim}
            userAddress={address ?? ''}
          />
        )}

      </div>
      </div>
    </div>
  );
}

