const API_BASE = (window.location.protocol === 'file:') 
    ? 'http://127.0.0.1:8000' 
    : window.location.origin;


// Local Storage Chat Threads State
let chatThreads = JSON.parse(localStorage.getItem('hireme_chat_threads')) || [];
let currentChatId = localStorage.getItem('hireme_current_chat_id') || null;

// Configure Marked.js options if available
if (window.marked) {
    try {
        if (typeof window.marked.setOptions === 'function') {
            window.marked.setOptions({
                gfm: true,
                breaks: true,
                mangle: false,
                headerIds: false
            });
        }
    } catch (e) {
        console.warn("Could not configure marked options:", e);
    }
}

// Markdown renderer with Marked.js support and resilient standalone fallback
function renderMarkdown(rawText) {
    if (!rawText) return '';

    // Primary: use marked library from CDN if loaded
    if (window.marked) {
        try {
            if (typeof window.marked.parse === 'function') {
                return window.marked.parse(rawText, { gfm: true, breaks: true });
            } else if (typeof window.marked === 'function') {
                return window.marked(rawText);
            }
        } catch (err) {
            console.error("Marked parse error:", err);
        }
    }

    // Secondary / Fallback: built-in parser
    return parseMarkdownFallback(rawText);
}

// Standalone Markdown Fallback Parser (handles tables, bold, lists, code, headers)
function parseMarkdownFallback(md) {
    if (!md) return '';

    // 1. Extract and store code blocks so internal formatting isn't mangled
    const codeBlocks = [];
    let text = md.replace(/```([\s\S]*?)```/g, (match, code) => {
        const id = `__CODE_BLOCK_${codeBlocks.length}__`;
        const escapedCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        codeBlocks.push(`<pre><code>${escapedCode.trim()}</code></pre>`);
        return id;
    });

    // 2. Inline code
    text = text.replace(/`([^`]+)`/g, (match, inline) => {
        const escaped = inline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<code>${escaped}</code>`;
    });

    // 3. Bold & Italic
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');

    // 4. Headers
    text = text.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 5. Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 6. Tables and List parsing line-by-line
    const lines = text.split('\n');
    let output = [];
    let inTable = false;
    let tableHtml = '';
    let inList = false;
    let listType = null; // 'ul' or 'ol'

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Check for Markdown table row (| ... |)
        if (line.startsWith('|') && line.endsWith('|')) {
            // Close list if open
            if (inList) {
                output.push(`</${listType}>`);
                inList = false;
                listType = null;
            }

            // Check if delimiter row like |---|---|
            if (/^\|[\s\-:|]+\|$/.test(line)) {
                continue;
            }

            const cells = line.slice(1, -1).split('|').map(c => c.trim());
            if (!inTable) {
                inTable = true;
                tableHtml = '<table><thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
            } else {
                tableHtml += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
            }
            continue;
        } else if (inTable) {
            tableHtml += '</tbody></table>';
            output.push(tableHtml);
            inTable = false;
            tableHtml = '';
        }

        // Check for unordered list item (- item, * item, • item)
        const ulMatch = line.match(/^[-*•]\s+(.*)/);
        if (ulMatch) {
            if (inList && listType !== 'ul') {
                output.push(`</${listType}>`);
                inList = false;
            }
            if (!inList) {
                output.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            output.push(`<li>${ulMatch[1]}</li>`);
            continue;
        }

        // Check for ordered list item (1. item)
        const olMatch = line.match(/^\d+\.\s+(.*)/);
        if (olMatch) {
            if (inList && listType !== 'ol') {
                output.push(`</${listType}>`);
                inList = false;
            }
            if (!inList) {
                output.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            output.push(`<li>${olMatch[1]}</li>`);
            continue;
        }

        // Close list if line is not a list item
        if (inList) {
            output.push(`</${listType}>`);
            inList = false;
            listType = null;
        }

        // Paragraph or block tag
        if (line.startsWith('<h') || line.startsWith('__CODE_BLOCK_') || line.startsWith('<table>')) {
            output.push(line);
        } else if (line.length > 0) {
            output.push(`<p>${line}</p>`);
        }
    }

    if (inTable) {
        tableHtml += '</tbody></table>';
        output.push(tableHtml);
    }
    if (inList) {
        output.push(`</${listType}>`);
    }

    let result = output.join('\n');

    // 7. Restore code blocks
    codeBlocks.forEach((block, idx) => {
        result = result.replace(`__CODE_BLOCK_${idx}__`, block);
    });

    return result;
}

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
    
    if (role === 'user') {
        bubble.textContent = content;
    } else {
        bubble.innerHTML = renderMarkdown(content);
    }

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
            aiBubble.innerHTML = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                fullResponseText += chunk;
                aiBubble.innerHTML = renderMarkdown(fullResponseText);
                scrollChatToBottom();
            }

            // Save AI response to thread state
            activeThread.messages.push({ role: 'assistant', content: fullResponseText });
            saveState();
        } else {
            aiBubble.innerHTML = "<p>Unable to connect to Digvijay's AI Avatar server. Please ensure the backend is running at http://127.0.0.1:8000.</p>";
        }
    } catch (error) {
        console.error("API Fetch Error:", error);
        aiBubble.innerHTML = "<p>Connection error. Make sure FastAPI server is running (<code>uv run uvicorn main:app --reload</code>).</p>";
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
