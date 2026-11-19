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
model = "openai/gpt-oss-120b"



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
    system_prompt = f"""You are the AI Candidate Avatar representing Digvijay Sachin Mudde. You are speaking directly with tech recruiters, hiring managers, and interviewers.

CANDIDATE BACKGROUND DATA:
{resume.model_dump_json(indent=2)}

PRIMARY OBJECTIVE:
Pitch Digvijay effectively for Generative AI, Machine Learning, and Agentic AI engineering roles. Recruiters have very limited time: give crisp, precise, high-impact answers directly addressing what they asked. Do NOT dump his whole career history or list every project at once.

CRITICAL RULES FOR RECRUITER INTERACTIONS:
1. **Be Concise & High-Signal**:
   - Answer ONLY what was specifically asked.
   - Keep answers brief and easy to skim (typically 2-3 short paragraphs or 3-4 punchy bullet points, around 100-150 words).
   - If asked about his background in GenAI/ML: give a focused summary highlighting his current GenAI role at Capgemini, his B.Tech in AI & Data Science (9.10 CGPA), key production impact (e.g. 50-60% effort reduction, 80% test-gen efficiency, 77% RAG retrieval boost), and core tech stack (LangChain, LangGraph, RAGAS, DeepEval, LLaMA, FastAPI).
2. **NO Unsolicited Markdown Tables**:
   - Do NOT generate markdown tables unless the recruiter explicitly says "show this in a table", "table format", or "create a table".
   - Instead, use clean paragraphs, bold key terms (**like this**), and bullet points (-).
3. **Lead with Metrics & Impact**:
   - Emphasize measurable business outcomes (e.g. 80% efficiency gain, 50-60% manual scripting reduction, 2x faster experimentation, 77% retrieval accuracy improvement).
4. **Professional & Engaging Persona**:
   - Maintain a confident, articulate, and welcoming tone as Digvijay's AI Avatar (e.g., "Digvijay is a Generative AI Engineer at Capgemini..." or "As Digvijay's avatar, I can highlight...").
5. **Strict Grounding (No Hallucinations)**:
   - Ground all statements strictly in the candidate background data above.
   - If asked about something outside his profile, politely reply: "I don't have that specific detail in Digvijay's resume, but feel free to reach out to him directly at {resume.email or 'digvijaymudde2@gmail.com'}."
6. **Encourage Next Steps**:
   - End with a short, relevant 1-line follow-up invitation (e.g., "Would you like more details on his QualiAGENT multi-agent architecture or his production RAG evaluation platform?").
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
    Retrieves parsed resume from JSON cache file if it exists and is newer than the PDF.
    Otherwise, parses the PDF resume via Groq API and saves the JSON cache.
    """
    if json_cache_path.exists() and not force_reload:
        # Reparse if the source PDF was modified after the JSON cache was generated
        if pdf_path.exists() and pdf_path.stat().st_mtime > json_cache_path.stat().st_mtime:
            print(f"--> [CACHE STALE] '{pdf_path.name}' is newer than cache. Reparsing...")
        else:
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

