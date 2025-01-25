//main.js

import { streamGemini } from './gemini-api.js';

let promptInput = document.querySelector('input[name="prompt"]');
let output = document.querySelector('.output');
let chatList = document.querySelector('#chat-list');
let newChatBtn = document.querySelector('#new-chat');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const promptForm = document.querySelector('#prompt-box');
let isAuthenticated = false;
let currentUser = null;

let currentSessionId = localStorage.getItem('currentSessionId') || Date.now().toString();
let sessions = JSON.parse(localStorage.getItem('sessions')) || [];

let sessionInputs = JSON.parse(localStorage.getItem('sessionInputs')) || {};


// Initialize markdown-it
const md = new markdownit();

window.onload = async () => {
    try {
        const authStatus = await fetch('/api/auth/status').then(res => res.json());
        isAuthenticated = authStatus.authenticated;
        currentUser = authStatus.user;

        if (!authStatus.authenticated) {
            showAuthModal();
        } else {
            if (sessions.length === 0) {
                addNewSession();
            } else {
                renderSessions();
                await loadSession(currentSessionId);
            }
        }
        
        // Initialize components
        initializeSidebar();
        initializeTheme();
        initializeAuthListeners();
    } catch (error) {
        console.error('Initialization error:', error);
    }
};

function initializeAuthListeners() {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(loginForm);
        await handleLogin(
            formData.get('email'),
            formData.get('password')
        );
    });

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(signupForm);
        await handleSignup(
            formData.get('email'),
            formData.get('password'),
            formData.get('name')
        );
    });
}

async function handleLogin(email, password) {
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        if (!response.ok) {
            throw new Error('Login failed');
        }
        
        const data = await response.json();
        isAuthenticated = data.authenticated;
        currentUser = data.user;
        
        handleAuthSuccess(data);
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please check your credentials.');
    }
}

async function handleSignup(email, password, name) {
    try {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, name })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Signup failed');
        }
        
        isAuthenticated = data.authenticated;
        currentUser = data.user;
        
        handleAuthSuccess(data);
        return data;

    } catch (error) {
        console.error('Signup error:', error);
        alert('Signup failed. Please try again.');
    }
}

// Add auth modal handlers
function showAuthModal() {
    const authModal = document.getElementById('auth-modal');
    authModal.style.display = 'block';
    
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const authTabs = document.querySelectorAll('.auth-tab');
    
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            authTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            loginForm.style.display = tabName === 'login' ? 'flex' : 'none';
            signupForm.style.display = tabName === 'signup' ? 'flex' : 'none';
        });
    });
    
}

function handleAuthSuccess(response) {
    isAuthenticated = response.authenticated;
    currentUser = response.user;
    document.getElementById('auth-modal').style.display = 'none';
    
    if (sessions.length === 0) {
        addNewSession();
    } else {
        renderSessions();
        loadSession(currentSessionId);
    }
}

function initializeSidebar() {
    const toggleButton = document.querySelector('.toggle-sidebar');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    
    // Load saved sidebar state
    const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
    }
    
    toggleButton.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        
        // Save sidebar state
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        
        // Handle mobile view
        if (window.innerWidth <= 768) {
            if (sidebar.classList.contains('collapsed')) {
                mainContent.style.marginLeft = '0';
            } else {
                mainContent.style.marginLeft = '300px';
            }
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768) {
            mainContent.style.marginLeft = '0';
        } else {
            mainContent.style.marginLeft = sidebar.classList.contains('collapsed') ? '60px' : '300px';
        }
    });
}


function addNewSession() {
    const sessionId = Date.now().toString();
    const session = {
        id: sessionId,
        title: 'New Chat',
        preview: ''
    };
    sessions.unshift(session);
    currentSessionId = sessionId;

    //Clear input for new session
    sessionInputs[sessionId] = '';
    localStorage.setItem('sessionInputs', JSON.stringify(sessionInputs));
    
    // Save to localStorage
    localStorage.setItem('sessions', JSON.stringify(sessions));
    localStorage.setItem('currentSessionId', currentSessionId);
    
    renderSessions();
    output.innerHTML = ''; // Clear output
    promptInput.value = ''; // Clear input
    return sessionId;
}

async function deleteSession(sessionId) {
    try {
        // Delete from backend
        const response = await fetch(`/api/history/${sessionId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Failed to delete chat history');
        }
        
        // Remove from sessions array
        sessions = sessions.filter(session => session.id !== sessionId);
        
        // Remove from sessionInputs
        delete sessionInputs[sessionId];
        
        // Update localStorage
        localStorage.setItem('sessions', JSON.stringify(sessions));
        localStorage.setItem('sessionInputs', JSON.stringify(sessionInputs));
        
        // If we deleted the current session, create a new one
        if (sessionId === currentSessionId) {
            addNewSession();
        }
        
        // Re-render sessions
        renderSessions();
        
    } catch (e) {
        console.error('Error deleting chat:', e);
        alert('Failed to delete chat history');
    }
}

function renderSessions() {
    chatList.innerHTML = '';
    sessions.forEach(session => {
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item ${session.id === currentSessionId ? 'active' : ''}`;
        
        // Create a compact version for collapsed state
        const compactContent = `
            <div class="chat-item-compact">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </div>
        `;
        
        // Create the full content version
        const fullContent = `
            <div class="chat-item-content">
                <div class="chat-item-title">${session.title}</div>
                <div class="chat-item-preview">${session.preview || 'No messages yet'}</div>
            </div>
            <button class="delete-chat-btn" aria-label="Delete chat">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
            </button>
        `;
        
        chatItem.innerHTML = `
            ${compactContent}
            ${fullContent}
        `;
        
        // Add click handler for the chat item
        chatItem.onclick = () => loadSession(session.id);
        
        // Add click handler for delete button
        const deleteBtn = chatItem.querySelector('.delete-chat-btn');
        if (deleteBtn) {
            deleteBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent triggering the chat item click
                if (confirm('Are you sure you want to delete this chat?')) {
                    deleteSession(session.id);
                }
            };
        }
        
        chatList.appendChild(chatItem);
    });
}

async function loadSession(sessionId) {
    try {
        if (!isAuthenticated) {
            showAuthModal();
            return;
        }
        

        try {

            // Save current session's input before switching
            sessionInputs[currentSessionId] = promptInput.value;
            localStorage.setItem('sessionInputs', JSON.stringify(sessionInputs));

            currentSessionId = sessionId;
            localStorage.setItem('currentSessionId', currentSessionId);

            // Load the saved input for this session (if any)
            promptInput.value = sessionInputs[sessionId] || '';
            
            const response = await fetch(`/api/history/${sessionId}`);
            const history = await response.json();
            
            // Clear existing messages
            output.innerHTML = '';
            
            // Display each message in the history
            history.forEach(message => {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${message.role}`;
                // Use markdown rendering for all messages
                messageDiv.innerHTML = md.render(message.content);
                output.appendChild(messageDiv);
            });
            
            // Update session preview and title if there are messages
            if (history.length > 0) {
                const humanMessages = history.filter(msg => msg.role === 'human');
                if (humanMessages.length > 0) {
                    const firstHumanMessage = humanMessages[0].content;
                    const session = sessions.find(s => s.id === sessionId);
                    if (session) {
                        session.preview = firstHumanMessage.substring(0, 50) + '...';
                        session.title = generateTitle(firstHumanMessage);
                        localStorage.setItem('sessions', JSON.stringify(sessions));
                    }
                }
            }
            
            renderSessions();
        } catch (e) {
            console.error('Error loading chat history:', e);
            output.innerHTML = '<div class="message error">Error loading chat history</div>';
        }
    } catch (e) {
        console.error('Error loading chat history:', e);
        if (e.status === 401) {
            showAuthModal();
        }
    }
}

function generateTitle(firstMessage) {
    const words = firstMessage.split(' ').slice(0, 4).join(' ');
    return words + (firstMessage.split(' ').length > 4 ? '...' : '');
}

newChatBtn.onclick = () => {
    addNewSession();
};

promptForm.onsubmit = async (ev) => {
    ev.preventDefault();
    
    if (!isAuthenticated) {
        showAuthModal();
        return;
    }

    const userMessage = document.createElement('div');
    userMessage.className = 'message human';
    // Use markdown rendering for user message
    userMessage.innerHTML = md.render(promptInput.value);
    output.appendChild(userMessage);

    const aiMessage = document.createElement('div');
    aiMessage.className = 'message ai';
    aiMessage.textContent = 'Generating...';
    output.appendChild(aiMessage);

    try {
        let contents = [{
            type: "text",
            text: promptInput.value,
        }];

        let stream = streamGemini({
            model: 'gemini-1.5-flash',
            contents,
            sessionId: currentSessionId,
        });

        let buffer = [];

        for await (let chunk of stream) {
            buffer.push(chunk);
            // Use markdown rendering for AI responses
            aiMessage.innerHTML = md.render(buffer.join(''));
        }

        // Update session preview and title after response
        const session = sessions.find(s => s.id === currentSessionId);
        if (session) {
            session.preview = promptInput.value.substring(0, 50) + '...';
            session.title = generateTitle(promptInput.value);
            localStorage.setItem('sessions', JSON.stringify(sessions));
            renderSessions();
        }

        // Clear input and saved draft after successful submission
        promptInput.value = '';
        sessionInputs[currentSessionId] = '';
        localStorage.setItem('sessionInputs', JSON.stringify(sessionInputs));

    } catch (e) {
        aiMessage.innerHTML = md.render(`Error: ${e.message}`);
    }
};


// Theme switching functionality
function initializeTheme() {
    const toggleButton = document.getElementById('theme-toggle');
    
    // Check for saved theme preference
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Handle theme switching
    toggleButton.addEventListener('click', function() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}