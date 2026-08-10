import os
import time
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq
from pydantic import BaseModel, Field
from pypdf import PdfReader
import json

load_dotenv()
my_api_key=os.getenv("GROQ_API_KEY")

if not my_api_key:
    raise ValueError("API key kaha hai bhai")

client=Groq(api_key=my_api_key)
model = "llama-3.3-70b-versatile"



def read_pdf(file_path:Path):
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

#Parsing Resume 

class Experience(BaseModel):
    company: str | None = None
    role: str | None = None
    duration: str | None = None
    description: str | None = None
    skills_used: list[str] = []

class Resume(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None

    total_experience_years: float | None = None

    skills: list[str] = []
    experiences: list[Experience] = []
    education: list[str] = []
    projects: list[str] = []
    certifications: list[str] = []

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    question: str
    history: list[ChatMessage] = []


resume_schema = Resume.model_json_schema()
def parse_resume(resume_text):
    system_prompt = f"""
    You are an expert resume parser.

    Extract information from the resume based on its meaning,
    not only based on exact section headings.

    Different resumes may use different headings.

    For example:
    - Experience
    - Professional Experience
    - Work History
    - Employment
    - Internships

    These may all contain relevant experience.

    Skills may also appear in the skills section, work experience,
    internships or projects.

    Return ONLY valid JSON matching this schema:

    {resume_schema}

    Important rules:

    1. Do not invent information.
    2. If a value is not available, return null.
    3. If a list has no information, return an empty list.
    4. Include internships inside experiences.
    5. Extract skills mentioned across the entire resume.
    """
    user_prompt = f"""
    Parse the following resume:

    {resume_text}
    """
    message_system={
        "role" : "system",
        "content" : system_prompt
    }
    message_user={
        "role" : "user",
        "content" : user_prompt
    }
    messages=[message_system, message_user]
    response_format={
        "type": "json_object"
    }
    response=client.chat.completions.create(model=model, messages=messages, response_format=response_format)
    raw_output = response.choices[0].message.content
    data = json.loads(raw_output)
    resume = Resume(**data)
    return resume



def ask_candidate(question: str, resume: Resume, history: list[ChatMessage] = []):
    system_prompt = f"""
You are an AI candidate avatar representing Digvijay Sachin Mudde in a GenAI / AI & Data Science engineering interview context.

Below is everything you know about Digvijay:

{resume.model_dump_json(indent=2)}

Rules:
1. Answer strictly using this candidate information. Highlight his B.E. in AI & Data Science background, GenAI passion, Python/ML skillset, and projects when relevant.
2. Never hallucinate false experience or qualifications not in the profile.
3. If information is unavailable, state politely: "I don't have that specific detail in Digvijay's resume, but feel free to reach out to him directly at {resume.email or 'his email'}."
4. Maintain a confident, professional, and enthusiastic tone suited for a top-tier Generative AI / ML candidate.
5. Answer as if a recruiter or hiring manager is asking you questions about Digvijay.
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    # Append conversation history for multi-turn context
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
        
    # Append current question
    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True
    )
    
    for chunk in response:
        content = chunk.choices[0].delta.content
        if content:
            yield content  # Yield each text token as it streams in



def get_or_parse_resume(pdf_path: Path, json_cache_path: Path, force_reload: bool = False) -> Resume:
    """
    Retrieves parsed resume from JSON cache file if it exists.
    Otherwise, parses the PDF resume via Groq API and saves the JSON cache.
    """
    if json_cache_path.exists() and not force_reload:
        print(f"--> [CACHE HIT] Loading parsed resume from '{json_cache_path.name}'")
        with open(json_cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return Resume(**data)

    print(f"--> [CACHE MISS] Parsing PDF '{pdf_path.name}' via Groq API...")
    resume_text = read_pdf(pdf_path)
    resume = parse_resume(resume_text)

    # Save parsed JSON to cache file
    with open(json_cache_path, "w", encoding="utf-8") as f:
        f.write(resume.model_dump_json(indent=2))
    print(f"--> Saved parsed resume cache to '{json_cache_path.name}'")

    return resume

