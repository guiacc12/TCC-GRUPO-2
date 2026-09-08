import crypto from 'node:crypto';
import { env } from '../config/env.js';

// AES-256-GCM com chave única em env (CRYPTO_KEY). Formato armazenado:
// "iv:tag:ciphertext" em base64 — autenticado: alteração no banco invalida a tag.

/** Cifra um texto (ou objeto, serializado em JSON) para guardar no banco. */
export function cifrar(valor) {
  const textoPlano = typeof valor === 'string' ? valor : JSON.stringify(valor);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', env.cryptoKey, iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

/** Decifra o formato "iv:tag:ciphertext" e devolve a string original. */
export function decifrar(blob) {
  const [iv, tag, cifrado] = blob.split(':').map((parte) => Buffer.from(parte, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', env.cryptoKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}

/** Decifra e faz JSON.parse — para credenciais guardadas como objeto. */
export function decifrarJson(blob) {
  return JSON.parse(decifrar(blob));
}
