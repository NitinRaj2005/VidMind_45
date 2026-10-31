import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: number;
  text: string;
  isUser: boolean;
}

const suggestions = [
  'Summarize this video in simple words',
  'Explain the key concepts step by step',
  'What are the most important takeaways?',
];

const getYouTubeId = (value: string) => {
  const match = value.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return match?.[1] ?? null;
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number>(Date.now());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('vidmind-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('vidmind-theme', theme); } catch { /* storage may be unavailable */ }
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const videoId = useMemo(() => {
    const allText = [...messages.map((message) => message.text), inputText].join(' ');
    return getYouTubeId(allText);
  }, [messages, inputText]);

  const recentQuestions = messages
    .filter((message) => message.isUser)
    .slice(-5)
    .reverse();

  const sendMessage = async (text = inputText) => {
    const trimmedText = text.trim();
    if (!trimmedText || isLoading) return;

    const userMessage: Message = { id: Date.now(), text: trimmedText, isUser: true };
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setSidebarOpen(false);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage.text, thread_id: threadId }),
      });

      if (!response.ok) throw new Error('Failed to get response');
      const data = await response.json();
      setMessages((prev) => [...prev, {
        id: Date.now(),
        text: data.answer || 'Something went wrong. Please try again.',
        isUser: false,
      }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages((prev) => [...prev, {
        id: Date.now(),
        text: 'Sorry, there was an error processing your request. Please check your connection and try again.',
        isUser: false,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetChat = () => {
    setMessages([]);
    setInputText('');
    setThreadId(Date.now());
    setSidebarOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const formatVideoLink = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : null;

  return (
    <div className="app-layout">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <a className="brand" href="/" onClick={(event) => event.preventDefault()} aria-label="VidMind home">
            <span className="brand-mark">▶</span>
            <span><strong>VidMind</strong><small>Ask · Learn · From Videos</small></span>
          </a>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">×</button>
        </div>

        <div className="sidebar-main">
          <button className="new-chat-button" onClick={resetChat}><span>＋</span> New chat</button>
          <div className="nav-group">
            <span className="nav-caption">Workspace</span>
            <button className="nav-item active" onClick={resetChat}><span className="nav-icon">⌂</span> Home</button>
            <div className="nav-item nav-static"><span className="nav-icon">◷</span> Current conversation</div>
          </div>
          <div className="recent-section">
            <span className="nav-caption">Recent questions</span>
            {recentQuestions.length ? recentQuestions.map((message) => (
              <button className="recent-item" key={message.id} title={message.text} onClick={() => { setInputText(message.text); inputRef.current?.focus(); setSidebarOpen(false); }}>
                <span>▢</span><span>{message.text}</span>
              </button>
            )) : <p className="sidebar-empty">Your questions will appear here during this chat.</p>}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-note-icon">✦</div>
          <div><strong>Learn from any video</strong><p>Ask questions and explore ideas with AI-powered video understanding.</p></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
          <div className="topbar-context"><span className="topbar-eyebrow">YOUR VIDEO LEARNING SPACE</span><strong>Workspace</strong></div>
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
              <span className={theme === 'light' ? 'selected' : ''}>☼</span><span className={theme === 'dark' ? 'selected' : ''}>☾</span>
            </button>
            <div className="profile-avatar" aria-label="VidMind profile">V</div>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="conversation-column">
            {messages.length === 0 ? (
              <div className="welcome-section">
                <div className="welcome-kicker"><span className="kicker-dot" /> VIDEO KNOWLEDGE, SIMPLIFIED</div>
                <h1>Learn anything.<br /><span>One video at a time.</span></h1>
                <p className="welcome-description">Add a YouTube video, ask a question, and get clear answers grounded in its transcript.</p>
                <div className="welcome-prompt-card">
                  <div className="prompt-icon">▶</div>
                  <div><strong>Start with a YouTube link or a question</strong><p>Paste a video URL or ask about a video you've already added to this conversation.</p></div>
                </div>
                <div className="suggestion-heading">TRY ASKING</div>
                <div className="suggestion-list">
                  {suggestions.map((suggestion) => <button className="suggestion-card" key={suggestion} onClick={() => { setInputText(suggestion); inputRef.current?.focus(); }}><span>{suggestion}</span><span className="suggestion-arrow">↗</span></button>)}
                </div>
              </div>
            ) : (
              <div className="conversation-content">
                <div className="conversation-heading"><div><span className="section-eyebrow">CONVERSATION</span><h1>Video Q&amp;A</h1></div><span className="message-count">{messages.length} messages</span></div>
                {messages.map((message) => (
                  <article key={message.id} className={`message-row ${message.isUser ? 'from-user' : 'from-ai'}`}>
                    <div className={`message-avatar ${message.isUser ? 'user-avatar' : 'ai-avatar'}`}>{message.isUser ? 'Y' : '▶'}</div>
                    <div className="message-body">
                      <div className="message-author">{message.isUser ? 'You' : 'VidMind'}<span>{message.isUser ? 'Your question' : 'AI response'}</span></div>
                      <div className={`message-content ${message.isUser ? 'user-content' : 'markdown'}`}>
                        {message.isUser ? message.text : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>}
                      </div>
                    </div>
                  </article>
                ))}
                {isLoading && <div className="message-row from-ai"><div className="message-avatar ai-avatar">▶</div><div className="message-body"><div className="message-author">VidMind<span>Thinking</span></div><div className="message-content loading"><span className="dot" /><span className="dot" /><span className="dot" /></div></div></div>}
                <div ref={messagesEndRef} />
              </div>
            )}

            <div className="composer-wrap">
              <div className="composer">
                <textarea ref={inputRef} value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={handleKeyDown} placeholder="Paste a YouTube URL or ask a question..." disabled={isLoading} rows={1} />
                <button className="send-button" onClick={() => sendMessage()} disabled={!inputText.trim() || isLoading} aria-label="Send message">{isLoading ? <span className="button-spinner" /> : '↑'}</button>
              </div>
              <p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
            </div>
          </section>

          <aside className="details-column">
            <section className="detail-card video-card">
              <div className="detail-card-heading"><div><span className="section-eyebrow">SOURCE</span><h2>Video details</h2></div><span className="card-menu">···</span></div>
              {videoId && formatVideoLink ? (
                <a className="video-preview" href={formatVideoLink} target="_blank" rel="noreferrer">
                  <div className="video-thumbnail"><img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt="YouTube video thumbnail" /><span className="play-overlay">▶</span></div>
                  <div className="video-meta"><strong>YouTube video</strong><span>Open original video ↗</span><small>Video ID: {videoId}</small></div>
                </a>
              ) : (
                <div className="empty-video"><div className="empty-video-icon">▶</div><strong>No video added yet</strong><p>Paste a YouTube link in the message box to get started.</p></div>
              )}
            </section>

            <section className="detail-card status-card">
              <div className="detail-card-heading"><div><span className="section-eyebrow">SESSION</span><h2>Activity</h2></div><span className={`status-pill ${isLoading ? 'working' : 'ready'}`}><i />{isLoading ? 'Working' : 'Ready'}</span></div>
              <div className="activity-list">
                <div className="activity-item"><span className={`activity-check ${videoId ? 'complete' : ''}`}>{videoId ? '✓' : '1'}</span><div><strong>Video link</strong><small>{videoId ? 'A YouTube link is in this conversation' : 'Add a YouTube URL to begin'}</small></div></div>
                <div className="activity-item"><span className={`activity-check ${messages.some((message) => !message.isUser) ? 'complete' : ''}`}>{messages.some((message) => !message.isUser) ? '✓' : '2'}</span><div><strong>Ask and explore</strong><small>{messages.some((message) => !message.isUser) ? 'Response received' : 'Your answers will appear here'}</small></div></div>
              </div>
            </section>

            <section className="detail-card about-card">
              <div className="detail-card-heading"><div><span className="section-eyebrow">ABOUT VIDMIND</span><h2>Grounded answers</h2></div><span className="about-sparkle">✦</span></div>
              <p>VidMind uses retrieval-augmented generation to answer questions using video transcript content.</p>
              <div className="about-tags"><span>Transcript search</span><span>AI-powered Q&amp;A</span></div>
              <p className="citation-note">Source links are shown when available in the generated answer. Timestamp citations depend on transcript timestamp availability.</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
