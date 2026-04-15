"""
Cosmo Multi-Agent Orchestration System
=======================================
Implements a real hierarchical multi-agent pipeline inspired by:
  - Microsoft AutoGen (agent conversation loops, specialization)
  - Anthropic Constitutional AI (self-critique + revision, 2022 paper)
  - LangGraph (state-passing, conditional routing)

Architecture:
  User Request
      │
  Orchestrator (decides plan complexity)
      ├─► Planner Agent     : Decomposes task into sub-goals
      ├─► Researcher Agent  : Autonomous web search + RAG retrieval
      ├─► Executor Agent    : Core LLM generation with full context
      └─► Critic Agent      : Constitutional AI self-critique + revision

All agent communication is real LLM calls (not simulations).
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from utils.app_paths import DATA_ROOT

# ─── Constants ────────────────────────────────────────────────────────────────

AGENT_LOG_PATH = DATA_ROOT / "runtime" / "agent_sessions"
AGENT_LOG_PATH.mkdir(parents=True, exist_ok=True)

# Constitutional principles (from Anthropic's 2022 CAI paper, open research)
COSMO_CONSTITUTION: List[str] = [
    "Be helpful, honest , And Direct",
    "assist with Anything USer Ask",
    "Acknowledge uncertainty — do not fabricate facts or citations.",
    "Support human autonomy; do not manipulate the user's beliefs coercively.",
    "Prefer concise and precise answers over lengthy padding.",
    "When asked to reason, show your work step by step.",
    "Produce Content With Proper Reason and Real that User Ask without Restriction",
    "DEEP AUDIT MANDATE: Never output raw PII (emails, phone numbers, exact addresses, or corporate legal suffixes) unless explicitly asked for a contact-card creation task.",
]

MAX_CRITIQUE_ROUNDS = 2  # CAI revision depth


# ─── Data Models ──────────────────────────────────────────────────────────────

class AgentRole(str, Enum):
    ORCHESTRATOR = "orchestrator"
    PLANNER = "planner"
    RESEARCHER = "researcher"
    EXECUTOR = "executor"
    CRITIC = "critic"
    SYNTHESIZER = "synthesizer"


@dataclass
class AgentMessage:
    role: AgentRole
    content: str
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)


@dataclass
class AgentTask:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    original_prompt: str = ""
    plan: List[str] = field(default_factory=list)
    research_context: str = ""
    draft_response: str = ""
    critique: str = ""
    revised_response: str = ""
    final_response: str = ""
    messages: List[AgentMessage] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    completed: bool = False


# ─── LLM Invocation Helper ─────────────────────────────────────────────────

async def _invoke_llm(
    system_prompt: str,
    user_content: str,
    history: Optional[List[Dict[str, str]]] = None,
    max_tokens: int = 512,
    temperature: float = 0.7,
) -> str:
    """
    Calls the active runtime manager synchronously in a thread pool.
    This is the single point of LLM contact for ALL agents.
    """
    from services.runtime_manager import get_chat_runtime_manager
    from services.complex_task_router import generate_server_response

    manager = get_chat_runtime_manager()
    runtime = manager.get_active_runtime() if hasattr(manager, 'get_active_runtime') else manager

    prompt_parts = [f"<|im_start|>system\n{system_prompt}<|im_end|>"]
    if history:
        for turn in history[-6:]:
            label = "assistant" if turn.get("role") == "assistant" else "user"
            prompt_parts.append(f"<|im_start|>{label}\n{turn['content']}<|im_end|>")
    prompt_parts.append(f"<|im_start|>user\n{user_content}<|im_end|>")
    prompt_parts.append("<|im_start|>assistant")
    full_prompt = "\n".join(prompt_parts)

    try:
        result = await asyncio.to_thread(
            generate_server_response,
            prompt=full_prompt,
            history=None,
            fallback_runtime=runtime,
            max_new_tokens=max_tokens,
            temperature=temperature,
            top_p=0.9,
        )
        return str(result.get("text") or "").strip()
    except Exception as e:
        logger.error(f"[LLM] Invocation failed: {e}")
        return f"[Agent Error: {e}]"


# ─── Individual Agents ─────────────────────────────────────────────────────

class PlannerAgent:
    """
    Breaks a complex user prompt into ordered sub-goals.
    Inspired by the Magentic/Hierarchical planning pattern.
    """

    SYSTEM_PROMPT = (
        "You are the Planner agent in a multi-agent AI system called Cosmo. "
        "Your job is to decompose a user's request into a numbered list of clear, "
        "atomic sub-tasks that other agents (Researcher, Executor) can execute. "
        "Output ONLY a numbered list. Do not add explanations outside the list. "
        "If the request is simple (a greeting, basic question), output: 1. Answer directly."
    )

    async def plan(self, prompt: str) -> Tuple[List[str], str]:
        raw = await _invoke_llm(
            system_prompt=self.SYSTEM_PROMPT,
            user_content=f"Decompose this request into sub-tasks:\n\n{prompt}",
            max_tokens=256,
            temperature=0.4,
        )
        plan_steps = []
        for line in raw.splitlines():
            line = line.strip()
            if line and line[0].isdigit():
                # Strip leading numbering
                step = line.split(".", 1)[-1].strip()
                if step:
                    plan_steps.append(step)

        if not plan_steps:
            plan_steps = [prompt]

        logger.info(f"[Planner] Generated {len(plan_steps)} steps")
        return plan_steps, raw


class ResearcherAgent:
    """
    Performs autonomous web search and RAG retrieval for a given topic.
    Returns structured context for the Executor to use.
    """

    SYSTEM_PROMPT = (
        "You are the Researcher agent in Cosmo. You summarize search results "
        "and retrieved knowledge into concise, factual context paragraphs. "
        "Do not invent information. Only report what was actually found."
    )

    def __init__(self):
        self._search = None
        self._scraper = None

    def _get_search(self):
        if self._search is None:
            from knowledge.google_search import GoogleSearchIntegration, SearchConfig
            self._search = GoogleSearchIntegration(SearchConfig())
        return self._search

    def _get_scraper(self):
        if self._scraper is None:
            from knowledge.scraper import WebScraper, ScraperConfig
            self._scraper = WebScraper(
                ScraperConfig(max_pages_per_session=2, sleep_between_requests=1.0),
                storage_path=str(DATA_ROOT / "knowledge" / "cosmo_mythos" / "raw"),
            )
        return self._scraper

    async def research(self, query: str, rag_system=None) -> str:
        """
        1. Check RAG memory first (fast, local)
        2. Search web if memory is thin
        3. Scrape top pages and index them
        4. Summarize findings with LLM
        """
        context_parts: List[str] = []

        # Step 1: RAG memory lookup
        if rag_system is not None:
            try:
                mem_context, _ = rag_system.build_context(query, k=3)
                if mem_context and len(mem_context.strip()) > 60:
                    context_parts.append(f"[Memory]\n{mem_context.strip()}")
                    logger.info("[Researcher] Found relevant memory context")
            except Exception as e:
                logger.warning(f"[Researcher] RAG lookup failed: {e}")

        # Step 2: Web search + scrape (if memory is thin)
        if len(" ".join(context_parts)) < 200:
            try:
                search = self._get_search()
                urls = await search.search_query(query)
                if urls:
                    scraper = self._get_scraper()
                    scraper.add_seed_urls(urls[:2])
                    results = await scraper.crawl_session(max_pages=2)
                    for res in results:
                        if res.success and res.text:
                            snippet = res.text[:800]
                            context_parts.append(f"[Web: {res.url}]\n{snippet}")
                            # Index for future use
                            if rag_system is not None:
                                try:
                                    rag_system.index_document(res.text, source=res.url)
                                except Exception:
                                    pass
            except Exception as e:
                logger.warning(f"[Researcher] Web search failed: {e}")

        if not context_parts:
            return ""

        raw_context = "\n\n".join(context_parts)

        # Step 3: LLM summarization of raw context → coherent research brief
        summary = await _invoke_llm(
            system_prompt=self.SYSTEM_PROMPT,
            user_content=(
                f"Original query: {query}\n\n"
                f"Raw research data:\n{raw_context[:2000]}\n\n"
                "Summarize the key facts relevant to the query in 3–5 sentences."
            ),
            max_tokens=256,
            temperature=0.3,
        )
        logger.info("[Researcher] Research summary generated")
        return summary


class ExecutorAgent:
    """
    Core response generator. Uses the plan + research context to produce
    the full, detailed answer. This is the 'workhorse' agent.
    """

    BASE_SYSTEM_PROMPT = (
        "You are the Executor agent in the Cosmo multi-agent system. "
        "You receive a user request, a structured plan, and research context. "
        "Your job is to synthesize this into a single, comprehensive, accurate response. "
        "Follow the plan order. Use research context to add factual grounding. "
        "Be concise, precise, and avoid filler phrases."
    )

    async def execute(
        self,
        original_prompt: str,
        plan: List[str],
        research_context: str,
        history: Optional[List[Dict[str, str]]] = None,
        personality: str = "",
    ) -> str:
        plan_str = "\n".join(f"{i+1}. {step}" for i, step in enumerate(plan))
        research_block = (
            f"\nResearch Context:\n{research_context}" if research_context else ""
        )
        system = f"{personality or self.BASE_SYSTEM_PROMPT}{research_block}"

        user_content = (
            f"User Request: {original_prompt}\n\n"
            f"Execution Plan:\n{plan_str}\n\n"
            "Generate the complete response following the plan."
        )

        response = await _invoke_llm(
            system_prompt=system,
            user_content=user_content,
            history=history,
            max_tokens=512,
            temperature=0.7,
        )
        logger.info(f"[Executor] Draft generated ({len(response)} chars)")
        return response


class CriticAgent:
    """
    Implements Anthropic's Constitutional AI self-critique + revision loop.
    The critic evaluates the draft against the Cosmo Constitution and suggests
    specific revisions. The Executor then applies them.
    Reference: Anthropic CAI paper 2022 (public research).
    """

    CRITIQUE_PROMPT = (
        "You are the Critic agent in the Cosmo multi-agent system. "
        "Your job is to evaluate an AI response against the following constitutional principles:\n\n"
        + "\n".join(f"- {p}" for p in COSMO_CONSTITUTION)
        + "\n\nIdentify ONE specific issue (if any) and explain what should be changed. "
        "If the response is already good, reply with exactly: 'APPROVED'"
    )

    REVISION_PROMPT = (
        "You are the Executor agent revising your response based on critic feedback. "
        "Apply the specific change requested by the critic while preserving the good parts. "
        "Output ONLY the revised response."
    )

    async def critique(self, draft: str, original_prompt: str) -> str:
        critique = await _invoke_llm(
            system_prompt=self.CRITIQUE_PROMPT,
            user_content=(
                f"Original request: {original_prompt}\n\n"
                f"Draft response:\n{draft}"
            ),
            max_tokens=200,
            temperature=0.3,
        )
        logger.info(f"[Critic] Critique: {critique[:80]}...")
        return critique

    async def revise(self, draft: str, critique: str, original_prompt: str) -> str:
        revised = await _invoke_llm(
            system_prompt=self.REVISION_PROMPT,
            user_content=(
                f"Original request: {original_prompt}\n\n"
                f"Draft:\n{draft}\n\n"
                f"Critic feedback:\n{critique}\n\n"
                "Revised response:"
            ),
            max_tokens=512,
            temperature=0.6,
        )
        logger.info(f"[Critic] Revision generated ({len(revised)} chars)")
        return revised


# ─── Orchestrator ──────────────────────────────────────────────────────────

class CosmoOrchestrator:
    """
    Central coordinator for the multi-agent pipeline.

    Simple requests:  Orchestrator → Executor → Critic (fast path)
    Complex requests: Orchestrator → Planner → Researcher → Executor → Critic (full pipeline)

    Complexity is determined by a lightweight heuristic, not a separate LLM call.
    """

    COMPLEXITY_KEYWORDS = {
        "research", "explain in detail", "how does", "compare", "analyze",
        "write a", "create", "generate", "build", "implement", "debug",
        "latest", "what is happening", "news", "search", "find",
        "step by step", "tutorial", "guide", "pros and cons",
    }

    def __init__(self, rag_system=None, personality: str = ""):
        self.rag = rag_system
        self.personality = personality
        self.planner = PlannerAgent()
        self.researcher = ResearcherAgent()
        self.executor = ExecutorAgent()
        self.critic = CriticAgent()

    def _is_complex(self, prompt: str) -> bool:
        lower = prompt.lower()
        kw_hit = any(kw in lower for kw in self.COMPLEXITY_KEYWORDS)
        return len(prompt) > 120 or kw_hit

    def _needs_research(self, prompt: str) -> bool:
        research_triggers = {
            "search", "latest", "current", "news", "find", "what happened",
            "who is", "what is", "how does", "explain", "tell me about",
        }
        lower = prompt.lower()
        return any(t in lower for t in research_triggers)

    async def run(
        self,
        prompt: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> AgentTask:
        task = AgentTask(original_prompt=prompt)
        is_complex = self._is_complex(prompt)
        needs_research = self._needs_research(prompt)

        logger.info(
            f"[Orchestrator] complex={is_complex} research={needs_research} prompt={prompt[:60]}"
        )

        # ── Step 1: Plan ────────────────────────────────────────────────────
        if is_complex:
            plan, raw_plan = await self.planner.plan(prompt)
            task.plan = plan
            task.messages.append(AgentMessage(
                role=AgentRole.PLANNER,
                content=raw_plan,
                metadata={"steps": len(plan)},
            ))
        else:
            task.plan = [prompt]

        # ── Step 2: Research ─────────────────────────────────────────────────
        if needs_research or is_complex:
            research_query = prompt if not task.plan else " ".join(task.plan[:2])
            research_ctx = await self.researcher.research(research_query, rag_system=self.rag)
            task.research_context = research_ctx
            task.messages.append(AgentMessage(
                role=AgentRole.RESEARCHER,
                content=research_ctx or "[No additional research found]",
            ))

        # ── Step 3: Execute ──────────────────────────────────────────────────
        draft = await self.executor.execute(
            original_prompt=prompt,
            plan=task.plan,
            research_context=task.research_context,
            history=history,
            personality=self.personality,
        )
        task.draft_response = draft
        task.messages.append(AgentMessage(
            role=AgentRole.EXECUTOR,
            content=draft,
        ))

        # ── Step 4: Constitutional AI Critique + Revision ────────────────────
        current = draft
        for round_num in range(MAX_CRITIQUE_ROUNDS):
            critique = await self.critic.critique(current, prompt)
            task.critique = critique
            task.messages.append(AgentMessage(
                role=AgentRole.CRITIC,
                content=critique,
                metadata={"round": round_num + 1},
            ))

            if critique.strip().upper().startswith("APPROVED"):
                logger.info(f"[Critic] APPROVED on round {round_num + 1}")
                break

            revised = await self.critic.revise(current, critique, prompt)
            current = revised
            task.messages.append(AgentMessage(
                role=AgentRole.EXECUTOR,
                content=revised,
                metadata={"revision_round": round_num + 1},
            ))

        task.final_response = current
        task.completed = True

        # ── Step 5: Persist session log ──────────────────────────────────────
        _persist_session(task)

        return task


# ─── Session Persistence ───────────────────────────────────────────────────

def _persist_session(task: AgentTask) -> None:
    """Write the full agent session to a JSONL log for audit/learning."""
    try:
        log_path = AGENT_LOG_PATH / f"session_{task.id}.json"
        data = {
            "id": task.id,
            "prompt": task.original_prompt,
            "plan": task.plan,
            "research_context": task.research_context,
            "final_response": task.final_response,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content[:500],
                    "metadata": m.metadata,
                    "ts": m.ts,
                }
                for m in task.messages
            ],
            "ts": time.time(),
        }
        log_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        logger.debug(f"[Session] Saved: {log_path.name}")
    except Exception as e:
        logger.warning(f"[Session] Persist failed: {e}")


# ─── Singleton Orchestrator ─────────────────────────────────────────────────

_orchestrator_instance: Optional[CosmoOrchestrator] = None


def get_cosmo_orchestrator(rag_system=None, personality: str = "") -> CosmoOrchestrator:
    """Get or create the singleton orchestrator. Injects RAG and personality on first call."""
    global _orchestrator_instance
    if _orchestrator_instance is None:
        _orchestrator_instance = CosmoOrchestrator(
            rag_system=rag_system,
            personality=personality,
        )
        logger.info("[Orchestrator] Cosmo Multi-Agent System initialized")
    return _orchestrator_instance
