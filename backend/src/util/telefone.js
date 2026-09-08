/**
 * Normaliza telefone brasileiro para o formato exigido pela Evolution API:
 * somente dígitos, com DDI 55 (ex.: 5511999998888). Devolve null se inválido.
 */
export function normalizarTelefone(bruto) {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '').replace(/^0+/, '');

  // 10–11 dígitos = DDD + número sem DDI
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;

  // Com DDI 55: 12 (fixo) ou 13 (celular com 9) dígitos
  if (!digitos.startsWith('55') || digitos.length < 12 || digitos.length > 13) return null;
  return digitos;
}
