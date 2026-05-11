export type VirtualBalanceProfile = {
  virtual_balance: number
}

export const DEFAULT_VIRTUAL_BALANCE = 10000

export function parseVirtualBalance(value: unknown, fallback = DEFAULT_VIRTUAL_BALANCE) {
  const balance = Number(value)
  return Number.isFinite(balance) && balance >= 0 ? balance : fallback
}

export async function fetchVirtualBalanceProfile(accessToken?: string): Promise<VirtualBalanceProfile> {
  const response = await fetch('/api/profile/capital', {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })

  if (!response.ok) {
    throw new Error('No se pudo cargar capital virtual')
  }

  const body = await response.json().catch(() => null)
  return {
    virtual_balance: parseVirtualBalance(body?.data?.virtual_balance),
  }
}