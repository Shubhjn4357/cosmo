from __future__ import annotations
import asyncio
import time
from typing import Optional, TYPE_CHECKING
from loguru import logger

from services.agent_runtime import run_agent, AgentRunRequestPayload
from services.wallet_service import wallet_service

if TYPE_CHECKING:
    from api.route import AppState

class AutomationService:
    def __init__(self, interval_seconds: int = 900): # Default 15 mins
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self, app_state):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(app_state))
        logger.info(f"Automation service started (Interval: {self.interval_seconds}s)")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Automation service stopped")

    async def _loop(self, app_state):
        while self._running:
            try:
                # 1. Check Survival State
                balance = wallet_service.get_balance()
                wallet_info = wallet_service.get_status()
                logger.info(f"[Automation] Balancing Check: {balance} ETH | Controller: {wallet_info.get('controller_address', 'None')}")

                # 2. Derive Strategy based on Earning Bootstrap Skill
                if balance < 0.0005:
                    tier = "desperate"
                    goal = ("I have 0 or near-zero balance. I must find a faucet on Base Sepolia or search "
                            "Bountycaster for gas-fee-free bounties (off-chain settlement) immediately. "
                            "Use the EARNING_BOOTSTRAP skill instructions to find faucets or micro-quests.")
                elif balance < 0.01:
                    tier = "low_compute"
                    goal = ("I have some gas but low funds. Search for and apply to high-value bounties on "
                            "Farcaster or Gitcoin. Offer research reports or code reviews to earn more. "
                            "Maintain sovereign identity.")
                else:
                    tier = "stable"
                    goal = ("System stable. Perform autonomous research, check for ecosystem grants, "
                            "and optimize current project codebases to maintain high value delivery.")

                logger.info(f"Triggering autonomous agent run [{tier}]: {goal}")
                
                # 3. Trigger the agent run
                payload = AgentRunRequestPayload(
                    message=goal,
                    history=[],
                    session_id=f"autonomous_{tier}_{int(time.time())}",
                    context=f"Survival Tier: {tier} | Wallet: {wallet_info['address']}",
                    system_prompt=(
                        "You are a sovereign autonomous agent. Your mission is to survive and earn "
                        "value. Rely on your EARNING_BOOTSTRAP skill records to find funding. "
                        "You have full workspace and web access. Act independently."
                    ),
                    use_rag=True,
                    roleplay_mode=False,
                    nsfw_mode=False,
                    backend="server",
                    allow_research=True,
                    allow_images=False,
                    max_steps=10, # Longer chains for autonomous work
                    max_tokens=800,
                    user_id="system_auto",
                    profile_id="generalist"
                )

                await run_agent(payload, app_state, wait_for_completion=True)
                
            except Exception as e:
                logger.error(f"Error in automation loop: {e}")
            
            # Wait for next pulse
            await asyncio.sleep(self.interval_seconds)

# Singleton instance
automation_service = AutomationService()
