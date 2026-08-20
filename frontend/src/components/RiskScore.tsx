import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS } from '../config/contracts.ts';
import RiskOracleABI from '../config/abis/RiskOracle.json';

type ClaimType = 0 | 1 | 2;

interface RiskScoreProps {
  claimType: ClaimType;
  claimAmount: bigint;
}

export function RiskScore({ claimType, claimAmount }: RiskScoreProps) {
  const { data: requiredCollateral, isLoading } = useReadContract({
    address: CONTRACTS.RiskOracle as `0x${string}`,
    abi: RiskOracleABI,
    functionName: 'getRequiredCollateral',
    args: [claimType, claimAmount],
    query: { enabled: claimAmount > 0n },
  });

  if (!claimAmount || claimAmount === 0n) return null;
  if (isLoading) return <p style={{ fontSize: '0.8rem', color: 'var(--text)' }}>Querying oracle…</p>;

  const collateral = requiredCollateral as bigint ?? 0n;
  const maxFunding = claimAmount - collateral;

  return (
    <div className="vf-stats">
      <div className="vf-stat">
        <span className="vf-stat-label">Required Collateral</span>
        <span className="vf-stat-value">{formatUnits(collateral, 18)} mUSD</span>
      </div>
      <div className="vf-stat">
        <span className="vf-stat-label">Max Investor Funding</span>
        <span className="vf-stat-value">{formatUnits(maxFunding, 18)} mUSD</span>
      </div>
      <div className="vf-stat">
        <span className="vf-stat-label">Collateral Ratio</span>
        <span className="vf-stat-value">
          {claimType === 0 ? '10%' : claimType === 1 ? '15%' : '20%'}
        </span>
      </div>
    </div>
  );
}
