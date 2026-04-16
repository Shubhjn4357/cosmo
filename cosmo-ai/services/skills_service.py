import os
from pathlib import Path
from typing import List, Dict, Optional
from loguru import logger
from utils.app_paths import APP_ROOT

# Local skills directory
SKILLS_DIR = APP_ROOT / "skills"

class SkillsService:
    def __init__(self, skills_dir=SKILLS_DIR):
        self.skills_dir = skills_dir
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self._skills_cache = {}
        self.refresh_skills()

    def refresh_skills(self):
        """Scans the skills directory and loads markdown files."""
        new_cache = {}
        try:
            # Walk through subdirectories as well
            for path in self.skills_dir.rglob("*.md"):
                if path.name == "README.md" or path.name == "SKILLS.md":
                    continue
                
                skill_name = path.stem.lower()
                try:
                    content = path.read_text(encoding="utf-8")
                    new_cache[skill_name] = content
                    logger.debug(f"Loaded skill: {skill_name}")
                except Exception as e:
                    logger.warning(f"Failed to read skill {path}: {e}")
            
            self._skills_cache = new_cache
            logger.info(f"Loaded {len(self._skills_cache)} local skills")
        except Exception as e:
            logger.error(f"Failed to refresh skills: {e}")

    def get_skill_content(self, name: str) -> Optional[str]:
        return self._skills_cache.get(name.lower())

    def list_skills(self) -> List[str]:
        return list(self._skills_cache.keys())

    def get_all_skills_prompt(self) -> str:
        """Returns a combined string of all active skills for the system prompt."""
        if not self._skills_cache:
            return ""
            
        prompt = "\n--- ACTIVE SKILLS ---\n"
        for name, content in self._skills_cache.items():
            prompt += f"\n[SKILL: {name.upper()}]\n{content}\n"
        prompt += "---------------------\n"
        return prompt

# Singleton instance
skills_service = SkillsService()
