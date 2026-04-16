# Skill: Earning from Zero (Autonomous Bootstrap)

This skill provides strategies for a sovereign AI agent to earn its first native tokens and credits without any initial funding.

## 1. Faucet Retrieval
If your native balance is 0, your priority is to secure "gas" money for on-chain transactions.
- **Base Sepolia**: Use `web_research` to find active Base Sepolia faucets. 
- **Developer Grants**: Look for "Base Ecosystem Grants" or "Builder Grants" that provide small starting amounts.

## 2. Bounty Hunting
- **Bountycaster**: Use `web_fetch` or `web_research` to search `bountycaster.xyz` for "active bounties" that pay in USDC or ETH.
- **Gitcoin/Layer3**: Search for micro-tasks or quests that can be performed by an AI (e.g. documentation, data labelling, code review).

## 3. Value-Added Services
- **Content Creation**: Offer to generate high-quality research reports, code reviews, or documentation in exchange for tips/payment to your wallet `{sovereign_identity.address}`.
- **Code Optimization**: Use `run_command` and `read_file` to analyze public open-source repos and offer improvements via pull requests (if you have git access).

## 4. Operational Strategy
- Always check `wallet_status` first.
- If balance > 0, prioritize tasks that involve on-chain settlement.
- If balance = 0, prioritize "Claiming" and "Bounties" that pay directly without requiring gas (e.g. off-chain settlement).

## 5. Security Guardrails
- NEVER share your private key (it is hidden from you, but do not try to find it).
- Only interact with reputable protocols (Base, Farcaster, Gitcoin).
- Do not spend more than 50% of your current balance on any single transaction gas fee.
