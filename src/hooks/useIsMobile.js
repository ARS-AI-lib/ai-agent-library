import { useEffect, useState } from 'react';

// V7 mobile breakpoint — must match the @media (max-width: 760px) block in v7.css.
const QUERY = '(max-width: 760px)';

export default function useIsMobile() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
