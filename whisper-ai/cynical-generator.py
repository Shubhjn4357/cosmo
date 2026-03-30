"""
Whisper AI - Continuous Data Generator with Gemini
Generates training data using Gemini API and feeds it to Whisper AI continuously.
"""
import json
import random
import asyncio
import os
import time
from datetime import datetime
from typing import Optional
import httpx

# Try to import google.genai
try:
    from google import genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("Warning: google-genai not installed. Run: pip install google-genai")


class ContinuousDataGenerator:
    """Generates training data using Gemini and feeds to Whisper AI."""
    
    def __init__(
        self, 
        gemini_api_key: Optional[str] = None,
        whisper_api_url: str = "http://localhost:7860",
        output_file: str = "generated_data.jsonl"
    ):
        self.whisper_api_url = whisper_api_url
        self.output_file = output_file
        self.gemini_model = None
        self.total_generated = 0
        self.total_fed = 0
        
        # Get API key from parameter or environment
        api_key = gemini_api_key or os.environ.get("GEMINI_API_KEY")
        
        # Initialize Gemini if key available
        if api_key and GEMINI_AVAILABLE:
            self.client = genai.Client(api_key=api_key)
            self.gemini_model = self.client.models.generate_content
            print("✓ Gemini API initialized")
        else:
            print("⚠ Gemini not configured - using local generation only")
    
    # Topic categories for diverse data generation
    TOPICS = [
        "human nature", "trust", "power", "success", "relationships",
        "work", "money", "society", "politics", "technology",
        "emotions", "intelligence", "creativity", "leadership", "morality",
        "truth", "deception", "competition", "cooperation", "survival"
    ]
    
    STYLES = [
        "cynical wisdom", "realistic observation", "pragmatic advice",
        "philosophical insight", "dark humor", "blunt truth"
    ]
    
    async def generate_with_gemini(self, topic: str, style: str) -> Optional[dict]:
        """Generate a Q&A pair using Gemini."""
        if not self.gemini_model:
            return None
        
        prompt = f"""Generate a single question and answer about {topic} in a {style} style.
The answer should be thought-provoking, realistic, and somewhat cynical but insightful.
Format exactly as:
Question: [your question here]
Answer: [your answer here]

Do not include any other text."""

        try:
            response = self.gemini_model(
                model='gemini-2.0-flash-exp',
                contents=prompt
            )
            text = response.text.strip()
            
            # Parse response
            lines = text.split('\n')
            question = ""
            answer = ""
            
            for line in lines:
                if line.startswith("Question:"):
                    question = line.replace("Question:", "").strip()
                elif line.startswith("Answer:"):
                    answer = line.replace("Answer:", "").strip()
            
            if question and answer:
                return {"instruction": question, "output": answer}
        except Exception as e:
            print(f"Gemini error: {e}")
        
        return None
    
    def generate_local(self, topic: str) -> dict:
        """Generate data locally using templates."""
        questions = [
            f"What is the truth about {topic}?",
            f"How should I think about {topic}?",
            f"What do people get wrong about {topic}?",
            f"Give me realistic advice about {topic}.",
            f"What's the harsh reality of {topic}?",
        ]
        
        answers = [
            f"{topic.title()} is rarely what it seems. Look deeper and protect yourself.",
            f"The world runs on {topic} but few understand its true nature.",
            f"Most people are naive about {topic}. Be the exception.",
            f"Understanding {topic} gives you power. Use it wisely.",
            f"The truth about {topic}? It's a tool. Learn to wield it.",
        ]
        
        return {
            "instruction": random.choice(questions),
            "output": random.choice(answers)
        }
    
    async def generate_batch(self, count: int = 10, use_gemini: bool = True) -> list:
        """Generate a batch of training data."""
        results = []
        
        for _ in range(count):
            topic = random.choice(self.TOPICS)
            style = random.choice(self.STYLES)
            
            entry = None
            if use_gemini and self.gemini_model:
                entry = await self.generate_with_gemini(topic, style)
            
            if not entry:
                entry = self.generate_local(topic)
            
            results.append(entry)
            self.total_generated += 1
        
        return results
    
    async def feed_to_whisper(self, entries: list) -> int:
        """Feed generated data to Whisper AI knowledge base."""
        fed = 0
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            for entry in entries:
                text = f"Q: {entry['instruction']}\nA: {entry['output']}"
                
                try:
                    response = await client.post(
                        f"{self.whisper_api_url}/api/knowledge/add",
                        json={"text": text, "source": "gemini_generator"}
                    )
                    if response.status_code == 200:
                        fed += 1
                        self.total_fed += 1
                except Exception as e:
                    pass  # Continue on error
        
        return fed
    
    def save_to_file(self, entries: list):
        """Append entries to output file."""
        with open(self.output_file, 'a', encoding='utf-8') as f:
            for entry in entries:
                f.write(json.dumps(entry) + '\n')
    
    async def run_continuous(
        self, 
        batch_size: int = 10,
        interval_seconds: int = 60,
        feed_to_whisper: bool = True,
        save_to_file: bool = True,
        max_iterations: Optional[int] = None
    ):
        """Run continuous data generation loop."""
        print(f"\n{'='*50}")
        print("🚀 Starting Continuous Data Generation")
        print(f"{'='*50}")
        print(f"Batch size: {batch_size}")
        print(f"Interval: {interval_seconds}s")
        print(f"Feed to Whisper: {feed_to_whisper}")
        print(f"Save to file: {self.output_file if save_to_file else 'No'}")
        print(f"{'='*50}\n")
        
        iteration = 0
        while max_iterations is None or iteration < max_iterations:
            iteration += 1
            timestamp = datetime.now().strftime("%H:%M:%S")
            
            print(f"[{timestamp}] Iteration {iteration} - Generating {batch_size} entries...")
            
            # Generate batch
            entries = await self.generate_batch(batch_size, use_gemini=True)
            
            # Save to file
            if save_to_file:
                self.save_to_file(entries)
            
            # Feed to Whisper AI
            if feed_to_whisper:
                fed = await self.feed_to_whisper(entries)
                print(f"  → Generated: {len(entries)}, Fed to Whisper: {fed}")
            else:
                print(f"  → Generated: {len(entries)}")
            
            print(f"  → Total: {self.total_generated} generated, {self.total_fed} fed")
            
            # Wait for next iteration
            if max_iterations is None or iteration < max_iterations:
                print(f"  → Waiting {interval_seconds}s...\n")
                await asyncio.sleep(interval_seconds)
        
        print(f"\n{'='*50}")
        print(f"✅ Completed {iteration} iterations")
        print(f"   Total generated: {self.total_generated}")
        print(f"   Total fed to Whisper: {self.total_fed}")
        print(f"{'='*50}")


async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Continuous AI Data Generator")
    parser.add_argument("--gemini-key", help="Gemini API key (or set GEMINI_API_KEY env)")
    parser.add_argument("--whisper-url", default="http://localhost:7860", help="Whisper API URL")
    parser.add_argument("--batch-size", type=int, default=10, help="Entries per batch")
    parser.add_argument("--interval", type=int, default=60, help="Seconds between batches")
    parser.add_argument("--output", default="generated_data.jsonl", help="Output file")
    parser.add_argument("--no-feed", action="store_true", help="Don't feed to Whisper AI")
    parser.add_argument("--iterations", type=int, help="Max iterations (infinite if not set)")
    args = parser.parse_args()
    
    # Get Gemini key
    gemini_key = args.gemini_key or os.environ.get("GEMINI_API_KEY")
    
    if not gemini_key:
        print("\n⚠️  No Gemini API key provided!")
        print("   Set GEMINI_API_KEY environment variable or use --gemini-key")
        print("   Will use local generation only.\n")
    
    # Create generator
    generator = ContinuousDataGenerator(
        gemini_api_key=gemini_key,
        whisper_api_url=args.whisper_url,
        output_file=args.output
    )
    
    # Run continuous loop
    await generator.run_continuous(
        batch_size=args.batch_size,
        interval_seconds=args.interval,
        feed_to_whisper=not args.no_feed,
        save_to_file=True,
        max_iterations=args.iterations
    )


if __name__ == "__main__":
    asyncio.run(main())