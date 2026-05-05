'use client';

import { useState, useEffect, useCallback } from 'react';
import { encrypt, decrypt } from './crypto';

const canUseStorage = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

async function decryptFields(
  obj: Record<string, unknown>,
  fields: string[]
): Promise<Record<string, unknown>> {
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === 'string' && result[field]) {
      result[field] = await decrypt(result[field] as string);
    }
  }
  return result;
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  encryptFields: string[] = []
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [storedValue, setStoredValue] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!canUseStorage) {
        setIsLoaded(true);
        return;
      }
      try {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          const decrypted = await decryptFields(parsed, encryptFields);
          setStoredValue(decrypted as T);
        }
      } catch {
        // Ignore errors, use default
      }
      setIsLoaded(true);
    };
    load();
  }, [key, encryptFields]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      if (!canUseStorage) return;
      try {
        setStoredValue(prev => {
          const newValue = value instanceof Function ? value(prev) : value;
          const toSave = { ...newValue } as Record<string, unknown>;
          for (const field of encryptFields) {
            if (typeof toSave[field] === 'string' && toSave[field]) {
              toSave[field] = encrypt(toSave[field] as string);
            }
          }
          localStorage.setItem(key, JSON.stringify(toSave));
          return newValue;
        });
      } catch {
        // Ignore errors
      }
    },
    [key, encryptFields]
  );

  const clearValue = useCallback(() => {
    if (!canUseStorage) return;
    localStorage.removeItem(key);
    setStoredValue(defaultValue);
  }, [key, defaultValue]);

  return [isLoaded ? storedValue : defaultValue, setValue, clearValue];
}