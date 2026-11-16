import { createContext, useContext } from 'react';
import type { ApiClient, InputTransferClient } from '@beetle/contracts/api';
export { ApiFailure, readResult, unknownOutcome, errorMessage } from './errors.js';

export const ApiContext = createContext<ApiClient | null>(null);
export const InputTransferContext = createContext<InputTransferClient | null>(null);
export function useInputTransfers(): InputTransferClient | null { return useContext(InputTransferContext); }
export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('API provider required');
  return client;
}
