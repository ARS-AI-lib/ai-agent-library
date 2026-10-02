import { useEffect, useState } from 'react';
import { onToast } from '../lib/toast';

// Dark pill, bottom centre, 3s. role="status" so screen readers announce it.
export default function Toast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let t;
    const off = onToast((m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(''), 3000);
    });
    return () => { off(); clearTimeout(t); };
  }, []);
  return (
    <div className={`v7-toast ${msg ? 'show' : ''}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
}
