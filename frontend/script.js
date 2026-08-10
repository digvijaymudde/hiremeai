const API_BASE = (window.location.protocol === 'file:') 
    ? 'http://127.0.0.1:8000' 
    : window.location.origin;


// Local Storage Chat Threads State
let chatThreads = JSON.parse(localStorage.getItem('hireme_chat_threads')) || [];
let currentChatId = localStorage.getItem('hireme_current_chat_id') || null;

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    renderHistoryList();
    
    if (currentChatId && getThreadById(currentChatId)) {
        loadThread(currentChatId);
    } else {
        startNewChat();
    }
});

// Sidebar Toggle Functionality
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

// Start New Chat Session
function startNewChat() {
    currentChatId = 'chat_' + Date.now();
    const newThread = {
        id: currentChatId,
        title: 'New Conversation',
        messages: [],
        timestamp: new Date().toISOString()
    };
    
    chatThreads.unshift(newThread);
    saveState();
    renderHistoryList();
    renderThreadView();
}

// Get Thread Object by ID
function getThreadById(id) {
    return chatThreads.find(t => t.id === id);
}

// Save LocalStorage State
function saveState() {
    localStorage.setItem('hireme_chat_threads', JSON.stringify(chatThreads));
    localStorage.setItem('hireme_current_chat_id', currentChatId);
}

// Render Sidebar History List
function renderHistoryList() {
    const listContainer = document.getElementById('history-list');
    listContainer.innerHTML = '';

    if (chatThreads.length === 0) {
        listContainer.innerHTML = '<div class="subtext" style="padding: 8px;">No past conversations.</div>';
        return;
    }

    chatThreads.forEach(thread => {
        const item = document.createElement('div');
        item.className = `history-item ${thread.id === currentChatId ? 'active' : ''}`;
        item.textContent = thread.title || 'Conversation';
        item.onclick = () => loadThread(thread.id);
        listContainer.appendChild(item);
    });
}

// Load Specific Thread into View
function loadThread(id) {
    currentChatId = id;
    saveState();
    renderHistoryList();
    renderThreadView();
    
    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
}

// Render Thread View (Welcome Screen vs Active Messages)
function renderThreadView() {
    const activeThread = getThreadById(currentChatId);
    const welcomeContainer = document.getElementById('welcome-container');
    const chatThread = document.getElementById('chat-thread');
    
    chatThread.innerHTML = '';

    if (!activeThread || activeThread.messages.length === 0) {
        welcomeContainer.style.display = 'flex';
        chatThread.style.display = 'none';
        return;
    }

    welcomeContainer.style.display = 'none';
    chatThread.style.display = 'flex';

    activeThread.messages.forEach(msg => {
        appendMessageUI(msg.role, msg.content);
    });

    scrollChatToBottom();
}

// Append Message UI Element
function appendMessageUI(role, content) {
    const chatThread = document.getElementById('chat-thread');
    
    const row = document.createElement('div');
    row.className = `msg-row ${role === 'user' ? 'user' : 'ai'}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : '✨';
    
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = content;

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatThread.appendChild(row);

    scrollChatToBottom();
    return bubble;
}

// Send Suggested Prompt from Welcome Screen
function sendPrompt(promptText) {
    const textarea = document.getElementById('chat-textarea');
    textarea.value = promptText;
    document.getElementById('chat-form').dispatchEvent(new Event('submit'));
}

// Handle Keydown in Textarea (Enter to send, Shift+Enter for newline)
function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('chat-form').dispatchEvent(new Event('submit'));
    }
}

// Handle Form Submission
async function handleFormSubmit(event) {
    event.preventDefault();
    const textarea = document.getElementById('chat-textarea');
    const question = textarea.value.trim();
    if (!question) return;

    // Reset textarea height
    textarea.value = '';
    textarea.style.height = 'auto';

    let activeThread = getThreadById(currentChatId);
    if (!activeThread) {
        startNewChat();
        activeThread = getThreadById(currentChatId);
    }

    // Set title on first message
    if (activeThread.messages.length === 0) {
        activeThread.title = question.length > 28 ? question.substring(0, 28) + '...' : question;
    }

    // Hide welcome screen
    document.getElementById('welcome-container').style.display = 'none';
    document.getElementById('chat-thread').style.display = 'flex';

    // Add user message to state & UI
    activeThread.messages.push({ role: 'user', content: question });
    appendMessageUI('user', question);
    saveState();
    renderHistoryList();

    // Append AI Thinking bubble
    const aiBubble = appendMessageUI('assistant', '');
    aiBubble.innerHTML = '<em>Thinking...</em>';

    // Prepare multi-turn history payload
    const historyPayload = activeThread.messages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content
    }));

    // Stream Response from FastAPI Backend
    let fullResponseText = "";
    try {
        const response = await fetch(`${API_BASE}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: question,
                history: historyPayload
            })
        });

        if (response.ok && response.body) {
            aiBubble.textContent = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                fullResponseText += chunk;
                aiBubble.textContent = fullResponseText;
                scrollChatToBottom();
            }

            // Save AI response to thread state
            activeThread.messages.push({ role: 'assistant', content: fullResponseText });
            saveState();
        } else {
            aiBubble.textContent = "Unable to connect to Digvijay's AI Avatar server. Please ensure the backend is running at http://127.0.0.1:8000.";
        }
    } catch (error) {
        console.error("API Fetch Error:", error);
        aiBubble.textContent = "Connection error. Make sure FastAPI server is running (`uv run uvicorn main:app --reload`).";
    }
}

// Clear All History
function clearAllHistory() {
    if (confirm("Are you sure you want to clear all chat history?")) {
        chatThreads = [];
        localStorage.removeItem('hireme_chat_threads');
        localStorage.removeItem('hireme_current_chat_id');
        startNewChat();
    }
}

// Auto scroll helper
function scrollChatToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}
