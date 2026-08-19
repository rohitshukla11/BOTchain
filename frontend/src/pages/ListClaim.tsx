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
import { RiskScore } from '../components/RiskScore.tsx';

const CLAIM_TYPES = ['Invoice', 'Royalty', 'Rental'] as const;

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

  return (
    <div className="vf-page">
      <h2>List a Claim</h2>
      <p className="sub">Mint a claim NFT representing a real-world asset obligation, then lock collateral to open it for investor funding.</p>

      {!isAllowlisted && (
        <div className="vf-alert vf-alert-error">
          Your address is not allowlisted as an originator. Ask the contract owner to call <code>setAllowlisted(yourAddress, true)</code>.
        </div>
      )}

      {/* Step 1 — Mint */}
      <div className="vf-card" style={{ opacity: step !== 'mint' ? 0.5 : 1 }}>
        <h3>Step 1 — Claim details</h3>

        <div className="vf-field">
          <label>Claim Type</label>
          <select
            className="vf-select"
            value={claimType}
            onChange={e => setClaimType(Number(e.target.value) as 0 | 1 | 2)}
            disabled={step !== 'mint'}
          >
            {CLAIM_TYPES.map((t, i) => <option key={t} value={i}>{t}</option>)}
          </select>
        </div>

        <div className="vf-field">
          <label>Claim Amount (mUSD)</label>
          <input
            className="vf-input"
            type="number"
            placeholder="e.g. 10000"
            value={amountStr}
            onChange={e => setAmountStr(e.target.value)}
            disabled={step !== 'mint'}
          />
        </div>

        <div className="vf-field">
          <label>Payment Due Date</label>
          <input
            className="vf-input"
            type="date"
            min={minDueDate}
            value={dueDateStr}
            onChange={e => setDueDateStr(e.target.value)}
            disabled={step !== 'mint'}
          />
        </div>

        <div className="vf-field">
          <label>Debtor Reference (optional)</label>
          <input
            className="vf-input"
            type="text"
            placeholder="e.g. invoice-001"
            value={debtorRef}
            onChange={e => setDebtorRef(e.target.value)}
            disabled={step !== 'mint'}
          />
        </div>

        {claimAmount > 0n && <RiskScore claimType={claimType} claimAmount={claimAmount} />}

        {step === 'mint' ? (
          <button
            className="vf-btn vf-btn-primary"
            disabled={!isAllowlisted || !amountStr || !dueDateStr || isTxPending}
            onClick={handleMint}
          >
            {isTxPending ? 'Minting…' : 'Mint Claim NFT'}
          </button>
        ) : (
          <div className="vf-alert vf-alert-success">
            ✓ Claim NFT minted — token ID <strong>{mintedTokenId?.toString()}</strong>
          </div>
        )}
      </div>

      {/* Step 2 — Lock collateral */}
      {step === 'collateral' && mintedTokenId !== null && (
        <div className="vf-card">
          <h3>Step 2 — Lock collateral</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text)' }}>
            Lock mUSD collateral against token ID <strong>{mintedTokenId.toString()}</strong>.
            The RiskOracle recommends {claimType === 0 ? '10%' : claimType === 1 ? '15%' : '20%'} of the claim amount for {CLAIM_TYPES[claimType]} claims.
          </p>

          <div className="vf-field">
            <label>Collateral Amount (mUSD)</label>
            <input
              className="vf-input"
              type="number"
              placeholder="e.g. 1000"
              value={collateralStr}
              onChange={e => setCollateralStr(e.target.value)}
            />
          </div>

          {claimAmount > 0n && <RiskScore claimType={claimType} claimAmount={claimAmount} />}

          <button
            className="vf-btn vf-btn-primary"
            disabled={!collateralStr || collateralAmount === 0n || isTxPending}
            onClick={handleLockCollateral}
          >
            {isTxPending ? 'Waiting for tx…' : 'Approve & Lock Collateral'}
          </button>
        </div>
      )}

      {/* Done */}
      {step === 'done' && mintedTokenId !== null && (
        <div className="vf-card">
          <h3>✓ Claim listed successfully</h3>
          <div className="vf-stats">
            <div className="vf-stat">
              <span className="vf-stat-label">Token ID</span>
              <span className="vf-stat-value">{mintedTokenId.toString()}</span>
            </div>
            <div className="vf-stat">
              <span className="vf-stat-label">Collateral Locked</span>
              <span className="vf-stat-value">{formatUnits(collateralAmount, 18)} mUSD</span>
            </div>
            <div className="vf-stat">
              <span className="vf-stat-label">Status</span>
              <span className="vf-badge vf-badge-green">Open for funding</span>
            </div>
          </div>
          <button
            className="vf-btn vf-btn-secondary"
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

      {/* Tx feedback */}
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
  );
}


