// Every callable goes through here so the test site can point at its own copy of
// the functions (deployed with a "test-" prefix, see scripts/deploy-test.sh).
// Production leaves VITE_FUNCTION_PREFIX unset and nothing changes.
import { getFunctions, httpsCallable as rawCallable } from 'firebase/functions';

const PREFIX = import.meta.env.VITE_FUNCTION_PREFIX ? `${import.meta.env.VITE_FUNCTION_PREFIX}-` : '';

export { getFunctions };
export const httpsCallable = (fns, name, opts) => rawCallable(fns, PREFIX + name, opts);
