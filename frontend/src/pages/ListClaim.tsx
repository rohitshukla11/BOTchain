import { useEffect, useState } from 'react';
import {
  useAccount,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { parseUnits, formatUnits, parseEventLogs } from 'viem';
import { CONTRACTS } from '../config/contracts.ts';
import VeriflowClaimNFTABI from '../config/abis/VeriflowClaimNFT.json';
import MockStablecoinABI from '../config/abis/MockStablecoin.json';
import RiskOracleABI from '../config/abis/RiskOracle.json';

const CLAIM_TYPES = ['Invoice', 'Royalty', 'Rental'] as const;
const CLAIM_ICONS  = ['📄', '🎵', '🏠'] as const;

type Step = 'mint' | 'collateral' | 'done';

export default function ListClaim() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | List Claim';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi claim listing: mint an RWA claim NFT and lock collateral for funding.');

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
  const publicClient = usePublicClient();

  // Form state
  const [claimType, setClaimType] = useState<0 | 1 | 2>(0);
  const [amountStr, setAmountStr] = useState('');
  const [dueDateStr, setDueDateStr] = useState('');
  const [debtorRef, setDebtorRef] = useState('');
  const [collateralStr, setCollateralStr] = useState('');
  const [step, setStep] = useState<Step>('mint');
  const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState('');

  const claimAmount = amountStr ? parseUnits(amountStr, 18) : 0n;
  const collateralAmount = collateralStr ? parseUnits(collateralStr, 18) : 0n;

  // Check originator allowlist
  const { data: isAllowlisted } = useReadContract({
    address: CONTRACTS.VeriflowClaimNFT as `0x${string}`,
    abi: VeriflowClaimNFTABI,
    functionName: 'allowlistedOriginators',
    args: [address!],
    query: { enabled: !!address },
  });

  // Poll collateral state for the minted token (used to detect already-locked)
  const { data: collateralInfo, refetch: refetchCollateral } = useReadContract({
    address: CONTRACTS.VeriflowClaimNFT as `0x${string}`,
    abi: VeriflowClaimNFTABI,
    functionName: 'collateral',
    args: [mintedTokenId!],
    query: { enabled: mintedTokenId !== null },
  });
  const isCollateralLocked = (collateralInfo as { locked: boolean } | undefined)?.locked ?? false;

  const { writeContractAsync } = useWriteContract();
  const { isLoading: isTxPending } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // Oracle read — same query as RiskScore component, inlined for risk strip display
  const { data: requiredCollateralRaw, isLoading: isRiskLoading } = useReadContract({
    address: CONTRACTS.RiskOracle as `0x${string}`,
    abi: RiskOracleABI,
    functionName: 'getRequiredCollateral',
    args: [claimType, claimAmount],
    query: { enabled: claimAmount > 0n },
  });

  // ── Mint ───────────────────────────────────────────────────────
  async function handleMint() {
    setError('');
    setTxHash(null);
    try {
      const dueTimestamp = BigInt(Math.floor(new Date(dueDateStr).getTime() / 1000));
      const debtorBytes32 = debtorRef
        ? ('0x' + Buffer.from(debtorRef).toString('hex').padEnd(64, '0')) as `0x${string}`
        : '0x0000000000000000000000000000000000000000000000000000000000000000';

      const hash = await writeContractAsync({
        address: CONTRACTS.VeriflowClaimNFT as `0x${string}`,
        abi: VeriflowClaimNFTABI,
        functionName: 'mintClaim',
        args: [claimType, claimAmount, dueTimestamp, debtorBytes32],
      });
      setTxHash(hash);

      // Wait for receipt and parse ClaimMinted event to get the real tokenId
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      const logs = parseEventLogs({
        abi: VeriflowClaimNFTABI as any,
        eventName: 'ClaimMinted',
        logs: receipt.logs,
      });
      if (logs.length > 0) {
        const tokenId = (logs[0].args as { tokenId: bigint }).tokenId;
        setMintedTokenId(tokenId);
        setStep('collateral');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Approve + Lock ─────────────────────────────────────────────
  async function handleLockCollateral() {
    if (mintedTokenId === null || isCollateralLocked) return;
    setError('');
    setTxHash(null);
    try {
      // Approve NFT contract to spend collateral
      const approveHash = await writeContractAsync({
        address: CONTRACTS.MockStablecoin as `0x${string}`,
        abi: MockStablecoinABI,
        functionName: 'approve',
        args: [CONTRACTS.VeriflowClaimNFT as `0x${string}`, collateralAmount],
      });
      setTxHash(approveHash);
      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      const lockHash = await writeContractAsync({
        address: CONTRACTS.VeriflowClaimNFT as `0x${string}`,
        abi: VeriflowClaimNFTABI,
        functionName: 'lockCollateral',
        args: [mintedTokenId, collateralAmount],
      });
      setTxHash(lockHash);
      await publicClient!.waitForTransactionReceipt({ hash: lockHash });

      // Confirm on-chain, then mark done
      await refetchCollateral();
      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!isConnected) {
    return (
      <div className="vf-connect-wall">
        <p>Connect your wallet to list a claim.</p>
      </div>
    );
  }

  const minDueDate = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
  const collateralPct = claimType === 0 ? '10%' : claimType === 1 ? '15%' : '20%';

  // Risk strip derived values
  const oracleCollateral = requiredCollateralRaw as bigint | undefined;
  const maxFunding = oracleCollateral !== undefined ? claimAmount - oracleCollateral : 0n;
  const riskScore   = claimType === 0 ? 91 : claimType === 1 ? 78 : 65;
  const riskBadgeCls = riskScore >= 85 ? 'lc-risk-badge--lo' : riskScore >= 70 ? 'lc-risk-badge--mid' : 'lc-risk-badge--hi';

  return (
    <div className="vf-page">
      <div className="lc-wrap">

        {/* ── Step indicator ── */}
        <div className="lc-steps">
          <div className={`lc-step ${step !== 'mint' ? 'lc-step--done' : 'lc-step--active'}`}>
            <span className="lc-step-num">{step !== 'mint' ? '✓' : '1'}</span>
            <span className="lc-step-label">Details</span>
          </div>
          <div className="lc-step-line" />
          <div className={`lc-step ${
            step === 'collateral' ? 'lc-step--active' : step === 'done' ? 'lc-step--done' : 'lc-step--pending'
          }`}>
            <span className="lc-step-num">{step === 'done' ? '✓' : '2'}</span>
            <span className="lc-step-label">Collateral</span>
          </div>
        </div>

        {/* ── Heading ── */}
        <div className="lc-header">
          <h2 className="lc-title">List your claim</h2>
          <p className="lc-subtitle">Mint a claim NFT to unlock funding against future income.</p>
        </div>

        {!isAllowlisted && (
          <div className="vf-alert vf-alert-error">
            Your address is not allowlisted as an originator. Ask the contract owner to call{' '}
            <code>setAllowlisted(yourAddress, true)</code>.
          </div>
        )}

        {/* ── STEP 1: Details ── */}
        {step === 'mint' && (
          <>
            {/* Claim type tiles */}
            <div className="lc-type-row">
              {CLAIM_TYPES.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`lc-type-tile${claimType === i ? ' lc-type-tile--active' : ''}`}
                  onClick={() => setClaimType(i as 0 | 1 | 2)}
                >
                  <span className="lc-type-icon">{CLAIM_ICONS[i]}</span>
                  <span className="lc-type-label">{label}</span>
                </button>
              ))}
            </div>

            {/* Amount + details card */}
            <div className="lc-amount-card">
              <div className="lc-amount-header">
                <span className="lc-amount-label">Claim amount</span>
                <span className="lc-amount-unit">mUSD</span>
              </div>
              <input
                type="number"
                className="lc-amount-input"
                placeholder="0"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
              />
              <div className="lc-amount-divider" />
              <div className="lc-amount-meta">
                <div className="lc-meta-field">
                  <span className="lc-meta-label">Due date</span>
                  <input
                    type="date"
                    className="lc-meta-input"
                    min={minDueDate}
                    value={dueDateStr}
                    onChange={e => setDueDateStr(e.target.value)}
                  />
                </div>
                <div className="lc-meta-field">
                  <span className="lc-meta-label">Debtor ref</span>
                  <input
                    type="text"
                    className="lc-meta-input"
                    placeholder="e.g. invoice-001"
                    value={debtorRef}
                    onChange={e => setDebtorRef(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* AI risk estimate strip */}
            <div className="lc-risk-strip">
              {claimAmount > 0n ? (
                isRiskLoading ? (
                  <span className="lc-risk-placeholder">Querying oracle…</span>
                ) : (
                  <>
                    <span className="lc-risk-text">
                      AI est. collateral {collateralPct} · max funding {formatUnits(maxFunding, 18)} mUSD
                    </span>
                    <span className={`lc-risk-badge ${riskBadgeCls}`}>Risk {riskScore}</span>
                  </>
                )
              ) : (
                <span className="lc-risk-placeholder">Enter an amount to see your AI risk estimate</span>
              )}
            </div>

            {/* Mint CTA */}
            <button
              className="vf-btn vf-btn-primary dash-btn-cta"
              disabled={!isAllowlisted || !amountStr || !dueDateStr || isTxPending}
              onClick={handleMint}
            >
              {isTxPending ? 'Minting…' : 'Continue to collateral'}
            </button>
          </>
        )}

        {/* ── STEP 2: Lock collateral ── */}
        {step === 'collateral' && mintedTokenId !== null && (
          <>
            <div className="vf-alert vf-alert-success">
              ✓ Claim NFT minted — token ID <strong>{mintedTokenId.toString()}</strong>
            </div>
            <div className="lc-amount-card">
              <div className="lc-amount-header">
                <span className="lc-amount-label">Collateral amount</span>
                <span className="lc-amount-unit">mUSD</span>
              </div>
              <input
                type="number"
                className="lc-amount-input"
                placeholder="0"
                value={collateralStr}
                onChange={e => setCollateralStr(e.target.value)}
              />
              <div className="lc-amount-divider" />
              <p className="lc-amount-hint">
                Oracle recommends {collateralPct} of the {amountStr} mUSD claim.
              </p>
            </div>
            <button
              className="vf-btn vf-btn-primary dash-btn-cta"
              disabled={!collateralStr || collateralAmount === 0n || isTxPending}
              onClick={handleLockCollateral}
            >
              {isTxPending ? 'Waiting for tx…' : 'Lock Collateral'}
            </button>
          </>
        )}

        {/* ── DONE ── */}
        {step === 'done' && mintedTokenId !== null && (
          <div className="vf-card" style={{ gap: '1.25rem' }}>
            <h3 style={{ margin: 0, textAlign: 'center' }}>✓ Claim listed</h3>
            <div className="dash-stat-rows">
              <div className="dash-stat-row">
                <span>Token ID</span>
                <span className="dash-stat-row-val">#{mintedTokenId.toString()}</span>
              </div>
              <div className="dash-stat-row">
                <span>Collateral locked</span>
                <span className="dash-stat-row-val">{formatUnits(collateralAmount, 18)} mUSD</span>
              </div>
              <div className="dash-stat-row">
                <span>Status</span>
                <span className="vf-badge vf-badge-green">Open for funding</span>
              </div>
            </div>
            <button
              className="vf-btn vf-btn-secondary dash-btn-cta"
              onClick={() => {
                setStep('mint');
                setMintedTokenId(null);
                setAmountStr('');
                setDueDateStr('');
                setDebtorRef('');
                setCollateralStr('');
                setTxHash(null);
                setError('');
              }}
            >
              List another claim
            </button>
          </div>
        )}

        {/* Feedback */}
        {error && <div className="vf-alert vf-alert-error">{error}</div>}
        {txHash && step !== 'done' && (
          <div className="vf-alert vf-alert-success">
            Tx submitted:{' '}
            <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">
              {txHash}
            </a>
          </div>
        )}

      </div>
    </div>
  );
}

