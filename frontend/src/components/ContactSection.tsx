import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Mail, Send } from 'lucide-react';
import { getContactEmail, sendContactMessage, type ContactMessage } from '../services/api';

const emptyMessage: ContactMessage = { name: '', email: '', subject: '', message: '' };
const configuredSupportEmail = 'riya.g290604@gmail.com';

export default function ContactSection() {
  const [supportEmail, setSupportEmail] = useState(configuredSupportEmail);
  const [form, setForm] = useState<ContactMessage>(emptyMessage);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    getContactEmail().then((email) => { if (mounted && email) setSupportEmail(email); });
    return () => { mounted = false; };
  }, []);

  function updateField(field: keyof ContactMessage, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (feedback) setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const message = await sendContactMessage(form);
      setForm(emptyMessage);
      setFeedback({ kind: 'success', message });
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'We could not send your message. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="contact-section section-frame" id="contact" aria-labelledby="contact-title">
      <div className="contact-intro">
        <div className="section-kicker">CONTACT</div>
        <h2 id="contact-title">Get in Touch</h2>
        <p>Have questions about MeetMind or need assistance? We'd love to hear from you. Send us a message and our team will get back to you.</p>
        <div className="contact-info-list">
          {supportEmail && <a className="contact-info-item" href={`mailto:${supportEmail}`}>
            <span className="contact-icon"><Mail size={16} /></span>
            <span><b>Email Us</b><small>{supportEmail}</small></span>
            <ArrowRight size={14} className="contact-info-arrow" />
          </a>}
          <div className="contact-info-item contact-support-item">
            <span className="contact-icon"><Send size={15} /></span>
            <span><b>Support</b><small>Reach out for product questions, technical issues, or general assistance.</small></span>
          </div>
        </div>
      </div>

      <form className="contact-form" onSubmit={submit}>
        <div className="contact-form-heading"><span>Send us a message</span><small>We typically respond as soon as we can.</small></div>
        <div className="contact-form-row">
          <label>Full Name<input name="name" autoComplete="name" required maxLength={120} value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Your name" /></label>
          <label>Email Address<input name="email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="you@example.com" /></label>
        </div>
        <label>Subject<input name="subject" required maxLength={200} value={form.subject} onChange={(event) => updateField('subject', event.target.value)} placeholder="How can we help?" /></label>
        <label>Message<textarea name="message" required minLength={20} maxLength={5000} rows={5} value={form.message} onChange={(event) => updateField('message', event.target.value)} placeholder="Tell us a little more about what you need…" /></label>
        <div className="contact-form-bottom">
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send Message'} {!submitting && <ArrowRight size={14} />}</button>
          <small>20–5,000 characters</small>
        </div>
        {feedback && <p className={`contact-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{feedback.message}</p>}
      </form>
    </section>
  );
}
