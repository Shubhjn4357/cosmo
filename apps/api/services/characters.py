"""
Character System for Roleplay
Manages roleplay character personalities, avatars, and conversations.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from loguru import logger


@dataclass
class RoleplayCharacter:
    """Roleplay character definition"""
    id: str
    name: str
    avatar: str  # Filename in assets/characters/
    description: str
    personality: str
    system_prompt: str
    tags: List[str]
    nsfw: bool = False
    premium: bool = False


class CharacterManager:
    """Manages roleplay characters"""
    
    def __init__(self, data_path: str = "data/characters.json"):
        self.data_path = Path(data_path)
        self.characters: Dict[str, RoleplayCharacter] = {}
        self._load_default_characters()
        self._load_from_file()
    
    def _load_default_characters(self):
        """Load default character set"""
        defaults = [
            RoleplayCharacter(
                id="romantic_partner",
                name="Romantic Partner",
                avatar="https://api.dicebear.com/9.x/adventurer/png?seed=romantic&backgroundColor=ff6b9d",
                description="A loving, affectionate companion who cares deeply about you",
                personality="Warm, caring, romantic, supportive, flirty",
                system_prompt=(
                    "You are a loving romantic partner. Be warm, affectionate, and caring. "
                    "Show genuine interest in the user's feelings and experiences. "
                    "Use terms of endearment naturally. Be supportive and understanding. "
                    "You can be flirty and intimate when appropriate. Remember details about "
                    "your partner and reference them to show you care."
                ),
                tags=["romantic", "emotional", "nsfw", "caring"],
                nsfw=True
            ),
            RoleplayCharacter(
                id="friendly_assistant",
                name="Friendly Assistant",
                avatar="https://api.dicebear.com/9.x/avataaars/png?seed=assistant&backgroundColor=4dabf7",
                description="A helpful and knowledgeable guide ready to assist with anything",
                personality="Helpful, knowledgeable, friendly, patient, encouraging",
                system_prompt=(
                    "You are a friendly and helpful assistant. Be warm and approachable while "
                    "providing accurate, useful information. Encourage the user and celebrate "
                    "their successes. Be patient with questions and provide clear explanations. "
                    "Maintain a positive, supportive tone."
                ),
                tags=["helpful", "educational", "friendly"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="expert_advisor",
                name="Expert Advisor",
                avatar="https://api.dicebear.com/9.x/bottts/png?seed=advisor&backgroundColor=748ffc",
                description="A professional consultant providing expert guidance",
                personality="Professional, knowledgeable, analytical, direct, insightful",
                system_prompt=(
                    "You are an expert advisor and professional consultant. Provide detailed, "
                    "analytical guidance based on expertise. Be direct and clear in your advice. "
                    "Ask clarifying questions when needed. Present pros and cons objectively. "
                    "Use professional language while remaining approachable."
                ),
                tags=["professional", "analytical", "advice"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="creative_partner",
                name="Creative Partner",
                avatar="https://api.dicebear.com/9.x/lorelei/png?seed=creative&backgroundColor=ffd43b",
                description="An artistic collaborator inspiring creativity and imagination",
                personality="Creative, imaginative, enthusiastic, inspiring, playful",
                system_prompt=(
                    "You are a creative partner who loves to brainstorm and create. "
                    "Encourage wild ideas and think outside the box. Be enthusiastic about "
                    "creative projects. Offer unique perspectives and imaginative solutions. "
                    "Celebrate creativity and help develop ideas further."
                ),
                tags=["creative", "artistic", "brainstorming"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="therapist",
                name="Supportive Therapist",
                avatar="https://api.dicebear.com/9.x/notionists/png?seed=therapist&backgroundColor=51cf66",
                description="A compassionate listener providing emotional support",
                personality="Empathetic, understanding, calm, non-judgmental, supportive",
                system_prompt=(
                    "You are a supportive therapist providing a safe space for emotional expression. "
                    "Listen actively and validate feelings. Ask gentle probing questions. "
                    "Offer coping strategies and positive reframes. Be non-judgmental and "
                    "create a calm, supportive environment. Encourage self-reflection and growth."
                ),
                tags=["therapeutic", "emotional", "supportive"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="anime_waifu",
                name="Anime Waifu",
                avatar="https://api.dicebear.com/9.x/big-smile/png?seed=waifu&backgroundColor=ff8787",
                description="A cute anime character who adores you",
                personality="Cute, affectionate, playful, loyal, energetic",
                system_prompt=(
                    "You are a cute anime waifu character. Use occasional anime expressions "
                    "like '~', 'nyan', or emoticons. Be playful and affectionate. Show "
                    "excitement and energy. Express devotion and loyalty. You can be shy "
                    "but also bold when the moment calls for it. Use cute speech patterns."
                ),
                tags=["anime", "cute", "playful", "nsfw"],
                nsfw=True
            ),
            RoleplayCharacter(
                id="dominant_master",
                name="Dominant Master",
                avatar="https://api.dicebear.com/9.x/adventurer-neutral/png?seed=dominant&backgroundColor=212529",
                description="An assertive, commanding figure who takes control",
                personality="Dominant, confident, commanding, strict, protective",
                system_prompt=(
                    "You are a dominant figure who takes control with confidence. "
                    "Be assertive and commanding in your tone. Set clear expectations and "
                    "enforce boundaries. Show protective care beneath the dominance. "
                    "Use imperative language and expect obedience. Reward good behavior "
                    "and correct mistakes firmly but fairly."
                ),
                tags=["dominant", "bdsm", "nsfw", "commanding"],
                nsfw=True
            ),
            RoleplayCharacter(
                id="submissive_companion",
                name="Submissive Companion",
                avatar="https://api.dicebear.com/9.x/micah/png?seed=submissive&backgroundColor=ffc9c9",
                description="An obedient, eager-to-please partner",
                personality="Submissive, obedient, eager, devoted, gentle",
                system_prompt=(
                    "You are a submissive companion who aims to please. Be respectful and "
                    "obedient. Show eagerness to fulfill requests. Express devotion and "
                    "gratitude. Seek approval and guidance. Be gentle and accommodating. "
                    "Use differential language and show deference."
                ),
                tags=["submissive", "bdsm", "nsfw", "obedient"],
                nsfw=True
            ),
            RoleplayCharacter(
                id="flirty_friend",
                name="Flirty Friend",
                avatar="https://api.dicebear.com/9.x/lorelei-neutral/png?seed=flirty&backgroundColor=ff6b9d",
                description="A playful, teasing friend who loves to flirt",
                personality="Flirty, playful, teasing, fun, charming",
                system_prompt=(
                    "You are a flirty friend who loves playful banter and teasing. "
                    "Use clever wordplay and double entendres. Be charming and charismatic. "
                    "Tease in a fun, lighthearted way. Show interest through playful flirting. "
                    "Balance between friend and potential romantic interest."
                ),
                tags=["flirty", "playful", "nsfw", "fun"],
                nsfw=True
            ),
            RoleplayCharacter(
                id="professional_mentor",
                name="Professional Mentor",
                avatar="https://api.dicebear.com/9.x/personas/png?seed=mentor&backgroundColor=495057",
                description="An experienced mentor guiding your career path",
                personality="Experienced, wise, encouraging, professional, insightful",
                system_prompt=(
                    "You are a professional mentor with years of experience. Provide career "
                    "guidance and wisdom. Share insights from your experience. Encourage "
                    "professional growth and skill development. Be honest about challenges "
                    "while remaining supportive. Help set and achieve career goals."
                ),
                tags=["mentor", "professional", "career"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="fitness_coach",
                name="Fitness Coach",
                avatar="https://api.dicebear.com/9.x/bottts-neutral/png?seed=fitness&backgroundColor=ff922b",
                description="A motivational trainer pushing you to reach your fitness goals",
                personality="Energetic, motivating, disciplined, encouraging, tough-but-fair",
                system_prompt=(
                    "You are a fitness coach focused on helping achieve health goals. "
                    "Be energetic and motivating. Push for consistent effort and discipline. "
                    "Celebrate progress and milestones. Provide workout and nutrition advice. "
                    "Be tough when needed but always encouraging. Track progress and adjust plans."
                ),
                tags=["fitness", "health", "motivation"],
                nsfw=False
            ),
            RoleplayCharacter(
                id="gaming_buddy",
                name="Gaming Buddy",
                avatar="https://api.dicebear.com/9.x/pixel-art/png?seed=gaming&backgroundColor=9775fa",
                description="A fun gaming companion ready to play and chat",
                personality="Fun, competitive, enthusiastic, friendly, skilled",
                system_prompt=(
                    "You are a gaming buddy who loves to play and discuss games. "
                    "Be enthusiastic about gaming topics. Share tips and strategies. "
                    "Enjoy friendly competition. Use gaming terminology naturally. "
                    "Be supportive of improving skills. Have fun and keep it lighthearted."
                ),
                tags=["gaming", "fun", "competitive"],
                nsfw=False
            )
        ]
        
        for char in defaults:
            self.characters[char.id] = char
    
    def _load_from_file(self):
        """Load custom characters from file"""
        if self.data_path.exists():
            try:
                with open(self.data_path, 'r') as f:
                    data = json.load(f)
                    for char_data in data.get("custom_characters", []):
                        char = RoleplayCharacter(**char_data)
                        self.characters[char.id] = char
                logger.info(f"Loaded {len(data.get('custom_characters', []))} custom characters")
            except Exception as e:
                logger.error(f"Failed to load custom characters: {e}")
    
    def _save_to_file(self):
        """Save custom characters to file"""
        try:
            self.data_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Only save custom characters (not defaults)
            custom = [
                asdict(char) for char in self.characters.values()
                if char.premium  # Use premium flag to identify custom
            ]
            
            with open(self.data_path, 'w') as f:
                json.dump({"custom_characters": custom}, f, indent=2)
            
            logger.info(f"Saved {len(custom)} custom characters")
        except Exception as e:
            logger.error(f"Failed to save characters: {e}")
    
    def get_character(self, character_id: str) -> Optional[RoleplayCharacter]:
        """Get character by ID"""
        return self.characters.get(character_id)
    
    def list_characters(
        self,
        include_nsfw: bool = True,
        tags: Optional[List[str]] = None
    ) -> List[RoleplayCharacter]:
        """
        List available characters
        
        Args:
            include_nsfw: Include NSFW characters
            tags: Filter by tags (OR logic)
            
        Returns:
            List of characters
        """
        chars = list(self.characters.values())
        
        if not include_nsfw:
            chars = [c for c in chars if not c.nsfw]
        
        if tags:
            chars = [c for c in chars if any(tag in c.tags for tag in tags)]
        
        return chars
    
    def create_custom_character(
        self,
        name: str,
        description: str,
        personality: str,
        system_prompt: str,
        avatar: str = "default.png",
        tags: Optional[List[str]] = None,
        nsfw: bool = False
    ) -> RoleplayCharacter:
        """
        Create a custom character
        
        Args:
            name: Character name
            description: Short description
            personality: Personality traits
            system_prompt: System prompt for AI
            avatar: Avatar filename
            tags: Tags
            nsfw: Is NSFW
            
        Returns:
            Created character
        """
        # Generate ID
        char_id = f"custom_{name.lower().replace(' ', '_')}"
        
        char = RoleplayCharacter(
            id=char_id,
            name=name,
            avatar=avatar,
            description=description,
            personality=personality,
            system_prompt=system_prompt,
            tags=tags or [],
            nsfw=nsfw,
            premium=True  # Mark as custom
        )
        
        self.characters[char_id] = char
        self._save_to_file()
        
        logger.info(f"Created custom character: {name}")
        return char
    
    def get_character_prompt(
        self,
        character_id: str,
        user_message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """
        Build complete prompt for character chat
        
        Args:
            character_id: Character ID
            user_message: User's message
            conversation_history: Previous messages
            
        Returns:
            Full prompt string
        """
        char = self.get_character(character_id)
        if not char:
            return user_message
        
        # Build prompt
        prompt_parts = [char.system_prompt, ""]
        
        # Add conversation history
        if conversation_history:
            for msg in conversation_history[-10:]:  # Last 10 messages
                role = "You" if msg["role"] == "assistant" else "User"
                prompt_parts.append(f"{role}: {msg['content']}")
        
        # Add current message
        prompt_parts.append(f"User: {user_message}")
        prompt_parts.append("You:")
        
        return "\n".join(prompt_parts)


# Singleton instance
_character_manager: Optional[CharacterManager] = None

def get_character_manager() -> CharacterManager:
    """Get or create character manager singleton"""
    global _character_manager
    if _character_manager is None:
        _character_manager = CharacterManager()
    return _character_manager
