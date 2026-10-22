export function validSignature(token: string): boolean {
  return token.startsWith('signed:');
}
