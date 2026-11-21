import { ArrowDown, ArrowRight, Menu, X } from 'lucide-react';
import { useState } from 'react';
import Logo from '../components/Logo';
import ContactSection from '../components/ContactSection';
import type { Navigate } from '../types';

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Header({ navigate }: { navigate: Navigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const jump = (id: string) => { setMenuOpen(false); scrollToSection(id); };

  return (
    <header className="site-header">
      <div className="nav-inner">
        <button className="logo-button" onClick={() => jump('top')} aria-label="MeetMind home"><Logo /></button>
        <nav className={`site-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <button onClick={() => jump('features')}>Product</button>
          <button onClick={() => jump('workflow')}>How it works</button>
          <button onClick={() => jump('about')}>About</button>
          <button onClick={() => jump('contact')}>Contact</button>
          <span className="nav-divider" />
          <button onClick={() => navigate('/login')}>Sign in</button>
          <button className="nav-cta" onClick={() => navigate('/app')}>Explore MeetMind</button>
        </nav>
        <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen}>
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </header>
  );
}

export default function LandingPage({ navigate }: { navigate: Navigate }) {
  return (
    <div className="public-site" id="top">
      <Header navigate={navigate} />
      <main>
        <section className="hero section-frame">
          <div className="hero-content">
            <div className="overline">MEETING NOTES, MADE ACTIONABLE</div>
            <h1>Turn meetings into<br /><em>work that gets done.</em></h1>
            <p>MeetMind is designed to turn meeting audio into a transcript, a concise summary, and tasks that people can review and own.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => navigate('/app')}>Explore workspace <ArrowRight size={15} /></button>
              <button className="quiet-button" onClick={() => scrollToSection('workflow')}>See how it works <ArrowDown size={14} /></button>
            </div>
          </div>
          <div className="hero-footnote"><span>Designed for meeting hosts and assignees.</span><span className="hero-scroll">Scroll to explore <ArrowDown size={13} /></span></div>
        </section>

        <section className="intro section-frame" id="features">
          <div className="section-kicker">PRODUCT</div>
          <h2>Clear outcomes<br />from every meeting.</h2>
          <p className="intro-copy">MeetMind connects meeting audio to accountable follow-up, with an Admin reviewing suggested outcomes before they are assigned.</p>
          <div className="three-columns">
            <FeatureColumn number="01" title="CAPTURE">Record meeting-tab audio and microphone audio as separate sources.</FeatureColumn>
            <FeatureColumn number="02" title="REVIEW">Check AI-generated summaries and action suggestions before sharing them.</FeatureColumn>
            <FeatureColumn number="03" title="FOLLOW THROUGH">Assign work with an owner and deadline, then track its status.</FeatureColumn>
          </div>
          <p className="product-status-note">Current backend support: health checks and audio file storage. Transcription, AI analysis, and task services are not connected yet.</p>
        </section>

        <Workflow />
        <Privacy />
        <About />
        <ContactSection />
        <section className="final-cta section-frame">
          <div className="section-kicker">MEETMIND WORKSPACE</div>
          <h2>Make the next meeting<br /><em>easier to act on.</em></h2>
          <p>Explore the current workspace or choose a role to sign in when authentication is available.</p>
          <div><button className="primary-button" onClick={() => navigate('/app')}>Explore workspace <ArrowRight size={15} /></button><button className="quiet-button" onClick={() => navigate('/login')}>Sign in</button></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function FeatureColumn({ number, title, children }: { number: string; title: string; children: string }) {
  return <div className="feature-column"><span className="column-number">{number}</span><h3>{title}</h3><p>{children}</p></div>;
}

function Workflow() {
  const steps = [
    ['01', 'Capture', 'Record meeting audio and your microphone separately.'],
    ['02', 'Transcribe', 'Whisper transcribes and synchronizes both sources.'],
    ['03', 'Review', 'An Admin checks the summary, decisions, and task suggestions.'],
    ['04', 'Assign', 'Assignees track their work and update its status.'],
  ];

  return (
    <section className="workflow section-frame" id="workflow">
      <div className="section-kicker">HOW IT WORKS</div>
      <div className="workflow-heading"><h2>From recording<br />to responsibility.</h2><p>This is the intended workflow. AI processing, task management, and reminders are not connected to the current backend.</p></div>
      <div className="workflow-line">{steps.map(([number, title, text]) => <div className="workflow-step" key={number}><span className="step-number">{number}</span><span className="step-connector" /><span className="step-dot" /><h3>{title}</h3><p>{text}</p></div>)}</div>
    </section>
  );
}

function Privacy() {
  return (
    <section className="privacy-section section-frame" id="privacy">
      <div className="privacy-heading"><div className="section-kicker">DATA HANDLING</div><h2>Clear about what<br />happens to audio.</h2><p>Only record after informing participants. Uploaded audio is stored by the current backend and is not deleted automatically. Retention cleanup is not implemented yet.</p></div>
    </section>
  );
}

function About() {
  return (
    <section className="about-section section-frame" id="about">
      <div className="section-kicker">ABOUT MEETMIND</div>
      <div className="about-grid"><h2>Built to make<br />meetings actionable.</h2><div><p>MeetMind explores how transcription and AI can reduce the manual work that follows a meeting.</p><p>Admins review suggested outcomes before assignment. Assignees can see their work, deadlines, and progress in one place.</p></div></div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer section-frame">
      <div className="footer-top"><div><button className="logo-button" onClick={() => scrollToSection('top')} aria-label="Back to top"><Logo /></button><p>Meeting notes, made actionable.</p></div><div className="footer-links"><div><b>Product</b><button onClick={() => scrollToSection('features')}>Overview</button><button onClick={() => scrollToSection('workflow')}>How it works</button></div><div><b>Company</b><button onClick={() => scrollToSection('about')}>About</button><button onClick={() => scrollToSection('contact')}>Contact</button><button onClick={() => scrollToSection('privacy')}>Data handling</button></div></div></div>
      <div className="footer-bottom"><span>© 2026 MeetMind</span><span>Project preview</span></div>
    </footer>
  );
}
