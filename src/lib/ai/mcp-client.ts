// Compatibility wrapper. New code should import quant-client directly.
export type { QuantToolResponse as MCPToolResponse } from './quant-client'
export { QuantClient as MCPClient, quantClient as mcpClient } from './quant-client'