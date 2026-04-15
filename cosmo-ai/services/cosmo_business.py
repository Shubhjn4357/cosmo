"""
Cosmo Business Intelligence Agent System
==========================================
A fully autonomous, self-directing business agent with Mythos Memory and Real-time Handoff.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, List, Optional, Union
from typing_extensions import TypedDict

from loguru import logger

from utils.app_paths import DATA_ROOT
from services.distillation_service import distill_memory_to_training

# ─── Storage ──────────────────────────────────────────────────────────────────

BUSINESS_SESSION_DIR = DATA_ROOT / "runtime" / "business_sessions"
BUSINESS_SESSION_DIR.mkdir(parents=True, exist_ok=True)

# ─── Enums & Data Models ──────────────────────────────────────────────────────

class EmployeeRole(str, Enum):
    CEO            = "ceo"             # Strategic planning, prioritization
    RESEARCH       = "research"        # Data gathering, web search, fact-finding
    ANALYST        = "analyst"         # Data synthesis, insight extraction
    DEVELOPER      = "developer"       # Code, technical implementation
    WRITER         = "writer"          # Reports, content, communication
    REVIEWER       = "reviewer"        # Quality control, critique, validation
    PRE_FLIGHT     = "pre_flight"      # Intent-to-Goal conversion


    WAITING    = "waiting_for_user"


class HandoffItem(TypedDict):
    role: str
    text: str
    ts: float
    user_id: Optional[str]
    agreements: Optional[List[str]]
    is_consensus_reached: Optional[bool]


class ConsensusVote(TypedDict):
    user_id: str
    agree: bool
    ts: float


@dataclass
class BusinessTask:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    title: str = ""
    description: str = ""
    assigned_to: EmployeeRole = EmployeeRole.ANALYST
    depends_on: List[str] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    output: str = ""
    review_notes: str = ""
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    error: Optional[str] = None


@dataclass
class BusinessSession:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    goal: str = ""
    company_context: str = ""
    tasks: List[BusinessTask] = field(default_factory=list)
    final_report: str = ""
    status: str = "pending"   # pending / running / completed / failed / waiting
    progress: int = 0          # 0–100
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    context_window: Dict[str, str] = field(default_factory=dict)
    
    # Real-time Handoff & Memory
    is_handoff_active: bool = False
    handoff_queue: List[HandoffItem] = field(default_factory=list)
    messages: List[HandoffItem] = field(default_factory=list)
    mission_tree: str = "" # Mermaid.js string
    
    # Collaborative Consensus
    consensus_votes: Dict[str, Dict[str, bool]] = field(default_factory=dict) # msg_id -> {user_id: agree}
    multi_user_mode: bool = False

    def register_vote(self, msg_id: str, user_id: str, agree: bool):
        if msg_id not in self.consensus_votes:
            self.consensus_votes[msg_id] = {}
        self.consensus_votes[msg_id][user_id] = agree

    def evaluate_consensus(self, msg_id: str) -> bool:
        """Determines if an instruction has reached 51% majority quorum."""
        if not self.multi_user_mode:
            return True
        votes = self.consensus_votes.get(msg_id, {})
        if not votes: return False
        
        # Determine active participants from message history
        participants = {m['user_id'] for m in self.messages if 'user_id' in m}
        if len(participants) <= 1: return True
        
        agree_count = sum(1 for v in votes.values() if v)
        quorum = (len(participants) // 2) + 1
        return agree_count >= quorum


# ─── Role System Prompts ──────────────────────────────────────────────────────

ROLE_PROMPTS: Dict[EmployeeRole, str] = {
    EmployeeRole.CEO: (
        "You are the CEO agent of Cosmo AI. Strategic, concise, and decision-driven."
    ),
    EmployeeRole.RESEARCH: (
        "You are the Research Agent. Gather facts, cite sources, and synthesize data."
    ),
    EmployeeRole.ANALYST: (
        "You are the Business Analyst. Extract insights and patterns from research."
    ),
    EmployeeRole.DEVELOPER: (
        "You are the Technical Developer. Write clean, working code and technical specs."
    ),
    EmployeeRole.WRITER: (
        "You are the Writer. Compile professional reports and polished content."
    ),
    EmployeeRole.REVIEWER: (
        "You are the Quality Review Agent. Evaluate work against the business goal and past Mythos lessons. "
        "Identity gaps and factual errors. Reply 'APPROVED' if quality is high."
    ),
    EmployeeRole.PRE_FLIGHT: (
        "You are the Pre-flight Analyst. Your job is to convert raw voice input into a structured "
        "Business Goal and Company Context. Be precise and professional."
    ),
}

# ─── LLM Call Helper ──────────────────────────────────────────────────────────

async def _call_llm(
    role: EmployeeRole,
    task_description: str,
    prior_context: str = "",
    max_tokens: int = 600,
    temperature: float = 0.65,
) -> str:
    from services.complex_task_router import generate_server_response
    from services.runtime_manager import get_chat_runtime_manager

    manager = get_chat_runtime_manager()
    runtime = manager.get_active_runtime() if hasattr(manager, "get_active_runtime") else manager

    system = ROLE_PROMPTS[role]
    if prior_context:
        system += f"\n\n--- Context from previous work ---\n{prior_context[:1200]}"

    prompt_parts = [
        f"<|im_start|>system\n{system}<|im_end|>",
        f"<|im_start|>user\n{task_description}<|im_end|>",
        "<|im_start|>assistant",
    ]
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
        logger.error(f"[Business LLM] {role.value} call failed: {e}")
        return f"[{role.value} Error: {e}]"


# ─── Employee Agents ──────────────────────────────────────────────────────────

class PreFlightAnalyst:
    """Converts raw input/voice into structured Goal/Context schema."""

    PROMPT = """Analyze the user's raw intent and structure it for a Cosmo Business Mission.
    
    Output ONLY valid JSON in this format:
    {
      "goal": "A clear, actionable primary goal",
      "company_context": "Background info about the business or scenario"
    }"""

    async def analyze(self, raw_text: str) -> Dict[str, str]:
        raw = await _call_llm(
            role=EmployeeRole.PRE_FLIGHT,
            task_description=f"{self.PROMPT}\n\nUser Intent: {raw_text}",
            max_tokens=300,
            temperature=0.3,
        )
        try:
            # Clean up JSON if LLM added markdown blocks
            clean = raw.replace("```json", "").replace("```", "").strip()
            return json.loads(clean)
        except Exception:
            return {"goal": raw_text, "company_context": "Direct intent via Voice-to-Goal"}


class CEOAgent:
    """Decomposes a business goal into a prioritized task list."""

    DECOMPOSE_PROMPT = """You are the CEO. Decompose the goal into 3-6 TASKS.
    Format: TASK|<role>|<title>|<description>
    Roles: research, analyst, developer, writer, reviewer
    
    After the tasks, output a Mermaid.js graph starting with 'MERMAID|graph TD'. 
    Describe the mission tree flow."""

    async def plan(self, goal: str, company_context: str) -> List[BusinessTask]:
        raw = await _call_llm(
            role=EmployeeRole.CEO,
            task_description=f"{self.DECOMPOSE_PROMPT}\n\nGoal: {goal}\nContext: {company_context}",
            max_tokens=400,
            temperature=0.4,
        )
        tasks = []
        for line in raw.splitlines():
            if not line.startswith("TASK|"): continue
            parts = line.split("|", 3)
            if len(parts) < 4: continue
            role_str, title, description = parts[1], parts[2], parts[3]
            try: 
                # Robust role lookup: handle both "research" and "researcher"
                r = role_str.strip().lower()
                if "research" in r: role = EmployeeRole.RESEARCH
                elif "analyst" in r: role = EmployeeRole.ANALYST
                elif "writer" in r: role = EmployeeRole.WRITER
                elif "developer" in r or "code" in r: role = EmployeeRole.DEVELOPER
                elif "review" in r: role = EmployeeRole.REVIEWER
                else: role = EmployeeRole(r)
            except: role = EmployeeRole.ANALYST
            tasks.append(BusinessTask(title=title, description=description, assigned_to=role))
        
        # Extract Mermaid
        mermaid = "graph TD\n"
        if "MERMAID|" in raw:
            mermaid = raw.split("MERMAID|")[-1].strip()
        else:
            # Fallback generation
            mermaid += f"  Goal[\"{goal[:30]}...\"]\n"
            for t in tasks:
                mermaid += f"  Goal --> {t.id}[\"{t.title}\"]\n"

        return tasks, mermaid


class ReviewerWorker:
    """Reviews work using Mythos persistence/memory for self-correction."""

    async def review(self, task: BusinessTask, output: str, goal: str) -> str:
        # Step 1: Query Mythos for past lessons via CosmoModel
        from services.cosmo_model import cosmo_instance
        lessons = ""
        try:
            # Query for similar tasks in RAG — include both generic knowledge and past lessons
            context, sources = cosmo_instance.rag.build_context(f"mistakes and specific lessons for {task.title} business research", k=3)
            if context:
                lessons = f"\n\n--- Mythos Context & Lessons (Past Missions) ---\n{context}"
        except Exception as e:
            logger.debug(f"Mythos lookup skipped: {e}")

        critique = await _call_llm(
            role=EmployeeRole.REVIEWER,
            task_description=(
                f"Goal: {goal}\nTask: {task.title}\nDescription: {task.description}\n\n"
                f"Work Output to Review:\n{output}\n"
                f"{lessons}\n\n"
                "Review the output against the goal and lessons. "
                "If it meets high standards, starts with 'APPROVED'. "
                "Otherwise, provide specific constructive feedback for revision."
            ),
            max_tokens=400,
            temperature=0.2,
        )
        
        # Step 2: Persist current critique to Mythos if it identifies valid errors/lessons
        if "APPROVED" not in critique.upper()[:20]:
            try:
                # Log the lesson to the graph
                with cosmo_instance.mythos_graph.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "type": "business_lesson",
                        "task": task.title,
                        "critique": critique,
                        "goal": goal,
                        "ts": time.time()
                    }) + "\n")
                
                # Also index it immediately in RAG
                cosmo_instance._ensure_embedder()
                cosmo_instance.rag.index_document(
                    f"Business Lesson for {task.title}: {critique}", 
                    source="mythos:business_lesson"
                )
            except Exception as e:
                logger.warning(f"Failed to persist lesson to Mythos: {e}")

        return critique

    async def revise_if_needed(self, task: BusinessTask, output: str, critique: str, goal: str) -> str:
        if critique.strip().upper().startswith("APPROVED"): return output
        return await _call_llm(
            role=task.assigned_to,
            task_description=f"Task: {task.title}\n{task.description}\n\nFeedback: {critique}\n\nREVISE:",
            max_tokens=600,
        )


class AutonomousBusinessEngine:
    """Modern Business Engine with Real-time Handoff and Specialist Agents."""

    def __init__(self):
        self.ceo = CEOAgent()
        self.reviewer = ReviewerWorker()
        self.pre_flight = PreFlightAnalyst()

    async def run(self, session: BusinessSession, on_progress: Optional[Callable[[BusinessSession], Any]] = None) -> BusinessSession:
        from api.route import app_state
        
        async def broadcast_status():
            try:
                # Real-time Web Socket Broadcast
                await app_state.ws_manager.broadcast(session.id, {
                    "type": "session_update",
                    "status": session.status,
                    "progress": session.progress,
                    "tasks": [
                        {"id": t.id, "title": t.title, "status": t.status.value} 
                        for t in session.tasks
                    ]
                })
            except Exception as e:
                logger.debug(f"Broadcast failed: {e}")
            
            if on_progress:
                on_progress(session)

        session.status = "running"
        _save_session(session)
        await broadcast_status()

        try:
            # Phase 1: Planning
            tasks, mermaid = await self.ceo.plan(session.goal, session.company_context)
            session.tasks = tasks
            session.mission_tree = mermaid
            session.progress = 5
            _save_session(session)
            await broadcast_status()

            for idx, task in enumerate(session.tasks):
                # ── Handoff Check ─────────────────────────────────────────────
                while session.is_handoff_active:
                    session.status = "waiting_for_user"
                    _save_session(session)
                    await broadcast_status()

                    # consensus check if multi-user
                    if session.multi_user_mode and session.messages:
                        latest_msg = session.messages[-1]
                        if latest_msg['role'] == 'user':
                    logger.info(f"[Session {session.id}] Paused: Waiting for consensus quorum...")
                    await asyncio.sleep(2) # Poll for vote changes
                
                # Resume status after quorum
                if session.status == "waiting_for_user":
                    session.status = "running"
                    _save_session(session)
                    await broadcast_status()

                task.status = TaskStatus.RUNNING
                task.started_at = time.time()
                _save_session(session)

                prior_ctx = _build_context_window(session)
                
                # Execution
                worker = ResearchWorker() if task.assigned_to == EmployeeRole.RESEARCH else SpecialistWorker()
                raw_output = await worker.execute(task, prior_ctx)

                # Review loop
                if task.assigned_to != EmployeeRole.REVIEWER:
                    critique = await self.reviewer.review(task, raw_output, session.goal)
                    task.review_notes = critique
                    task.output = await self.reviewer.revise_if_needed(task, raw_output, critique, session.goal)
                else:
                    task.output = raw_output

                task.status = TaskStatus.COMPLETED
                task.completed_at = time.time()
                session.progress = 5 + int(((idx + 1) / len(session.tasks)) * 85)
                _save_session(session)
                await broadcast_status()

            # Final Report
            session.final_report = await ReportWriter().compile(session)
            session.status = "completed"
            session.progress = 100
            session.completed_at = time.time()
            
            # Auto-Distillation: Sync Mythos to Model
            try:
                from api.route import get_app_state
                distill_memory_to_training(get_app_state(), steps=150)
            except Exception as e:
                logger.warning(f"Auto-distillation deferred: {e}")

        except Exception as e:
            logger.error(f"Session {session.id} failed: {e}")
            session.status = "failed"
            session.final_report = f"Error: {e}"

        _save_session(session)
        await broadcast_status()
        return session

    async def run_hardware_diagnostics(self) -> Dict[str, Any]:
            test_file.write_text("ok")
            results["filesystem"]["writable"] = test_file.read_text() == "ok"
            test_file.unlink()
        except: pass
        
        # Mythos Check
        from services.cosmo_model import cosmo_instance
        if cosmo_instance.mythos_graph.exists():
            results["mythos"]["graph_exists"] = True
            with cosmo_instance.mythos_graph.open("r", encoding="utf-8") as f:
                results["mythos"]["lesson_count"] = sum(1 for _ in f)
                
        return results


# ─── Helper Functions & Persistence ───────────────────────────────────────────

def _build_context_window(session: BusinessSession) -> str:
    parts = []
    for t in session.tasks:
        if t.status == TaskStatus.COMPLETED and t.output:
            parts.append(f"[{t.title}]\n{t.output[:400]}")
    return "\n\n".join(parts)

def _save_session(session: BusinessSession) -> None:
    path = BUSINESS_SESSION_DIR / f"{session.id}.json"
    try:
        data = {
            "id": session.id,
            "goal": session.goal,
            "company_context": session.company_context,
            "status": session.status,
            "progress": session.progress,
            "created_at": session.created_at,
            "completed_at": session.completed_at,
            "final_report": session.final_report,
            "is_handoff_active": session.is_handoff_active,
            "handoff_queue": session.handoff_queue,
            "messages": session.messages,
            "tasks": [
                {
                    "id": t.id, "title": t.title, "description": t.description,
                    "assigned_to": t.assigned_to.value, "status": t.status.value,
                    "output": t.output, "review_notes": t.review_notes
                } for t in session.tasks
            ]
        }
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"Save failed: {e}")

# (List/Load helpers preserved from original implementation)
def load_session(session_id: str) -> Optional[Dict[str, Any]]:
    path = BUSINESS_SESSION_DIR / f"{session_id}.json"
    if not path.exists(): return None
    try: return json.loads(path.read_text(encoding="utf-8"))
    except: return None

def list_sessions(limit: int = 30) -> List[Dict[str, Any]]:
    files = sorted(BUSINESS_SESSION_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    sessions = []
    for f in files[:limit]:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            sessions.append({"id": d["id"], "goal": d.get("goal")[:100], "status": d.get("status"), "progress": d.get("progress", 0), "created_at": d.get("created_at")})
        except: pass
    return sessions

_engine_instance = None
def get_business_engine() -> AutonomousBusinessEngine:
    global _engine_instance
    if _engine_instance is None: _engine_instance = AutonomousBusinessEngine()
    return _engine_instance

async def launch_session(goal: str, company_context: str = "") -> BusinessSession:
    session = BusinessSession(goal=goal, company_context=company_context)
    _save_session(session)
    asyncio.create_task(get_business_engine().run(session))
    return session

def is_session_running(session_id: str) -> bool:
    return any(t.status == TaskStatus.RUNNING for t in (load_session(session_id) or {}).get("tasks", []))

# Specialist & Research workers (Generic fall-back wrappers for engine usage)
class SpecialistWorker:
    async def execute(self, task: BusinessTask, context: str) -> str:
        return await _call_llm(task.assigned_to, f"Task: {task.title}\n{task.description}", context)

class ResearchWorker:
    async def execute(self, task: BusinessTask, context: str) -> str:
        from services.cosmo_model import cosmo_instance
        res = await cosmo_instance._tool_web_search(task.description)
        return await _call_llm(EmployeeRole.RESEARCH, f"Query: {task.description}\nSearch: {res}", context)

class ReportWriter:
    async def compile(self, session: BusinessSession) -> str:
        task_data = "\n\n".join([f"## {t.title}\n{t.output}" for t in session.tasks if t.status == TaskStatus.COMPLETED])
        return await _call_llm(EmployeeRole.WRITER, f"Goal: {session.goal}\n\nTasks:\n{task_data}\n\nWrite Summary Report.")
