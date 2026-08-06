import { Component } from 'react';

// Wraps the whole app at the mount point (main.jsx), not inside App.jsx —
// there is no ErrorBoundary anywhere in this codebase today, so a throw in
// ANY component (a malformed Firestore doc hitting an unguarded `.map()`,
// for example) unmounts the entire tree and leaves a blank white page with
// nothing in the UI to explain why. React only supports this via a class
// component (getDerivedStateFromError/componentDidCatch have no hook
// equivalent yet) — everything else in this codebase is functional
// components, so this file is deliberately the one exception.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No error-reporting service wired up in this project — console is the
    // only place this is currently visible, same as everywhere else in the
    // app that logs failures.
    console.error('Unhandled error in the component tree:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        background: 'var(--bg)', color: 'var(--tx)', textAlign: 'center', padding: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>เกิดข้อผิดพลาด ลองรีเฟรชหน้านี้ครับ</div>
        <div style={{ fontSize: 12.5, color: 'var(--mu)', maxWidth: 420 }}>
          ถ้ารีเฟรชแล้วยังเจอปัญหาเดิม รบกวนแจ้งผู้ดูแลระบบพร้อมบอกว่ากำลังทำอะไรอยู่ตอนที่เจอ
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          รีเฟรชหน้านี้
        </button>
      </div>
    );
  }
}
