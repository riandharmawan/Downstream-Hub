import { useEffect, useState } from 'react';
import { fetchPasswordRequirements } from '../lib/passwordRequirements';

export default function usePasswordRequirements() {
  const [requirements, setRequirements] = useState(null);

  useEffect(() => {
    let ignore = false;
    fetchPasswordRequirements().then((data) => {
      if (!ignore) setRequirements(data);
    });
    return () => {
      ignore = true;
    };
  }, []);

  return requirements;
}
