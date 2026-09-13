import { Router } from 'express';
import { z } from 'zod';
import { banco } from '../config/banco.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasDominios = Router();

const esquemaDominio = z.object({
  dominio: z
    .string()
    .url('informe a URL do site, ex.: https://meusite.com.br')
    .max(255)
    // Normaliza para o formato de Origin: esquema + host (+ porta), sem path
    .transform((url, contexto) => {
      const endereco = new URL(url);
      if (!['http:', 'https:'].includes(endereco.protocol)) {
        contexto.addIssue({ code: z.ZodIssueCode.custom, message: 'use uma URL HTTP ou HTTPS' });
        return z.NEVER;
      }
      return endereco.origin;
    }),
});

rotasDominios.get('/', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      'SELECT id, dominio, criado_em FROM dominios_autorizados WHERE empresa_id = ? ORDER BY dominio',
      [req.empresaId]
    );
    res.json({ sucesso: true, dominios: linhas });
  } catch (erro) {
    next(erro);
  }
});

rotasDominios.post('/', async (req, res, next) => {
  try {
    const { dominio } = esquemaDominio.parse(req.body);
    const [resultado] = await banco.query(
      'INSERT INTO dominios_autorizados (empresa_id, dominio) VALUES (?, ?)',
      [req.empresaId, dominio]
    );
    res.status(201).json({ sucesso: true, id: resultado.insertId, dominio });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') return next(new ErroHttp(409, 'Domínio já cadastrado'));
    next(erro);
  }
});

rotasDominios.put('/:id', async (req, res, next) => {
  try {
    const id = z.string().regex(/^[1-9]\d*$/, 'ID inválido').parse(req.params.id);
    const { dominio } = esquemaDominio.parse(req.body);
    const [resultado] = await banco.query(
      'UPDATE dominios_autorizados SET dominio = ? WHERE id = ? AND empresa_id = ?',
      [dominio, id, req.empresaId]
    );
    // mysql2 usa FOUND_ROWS: salvar o mesmo valor também conta como registro encontrado.
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Domínio não encontrado');
    res.json({ sucesso: true, dominio });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') return next(new ErroHttp(409, 'Domínio já cadastrado'));
    next(erro);
  }
});

rotasDominios.delete('/:id', async (req, res, next) => {
  try {
    const [resultado] = await banco.query(
      'DELETE FROM dominios_autorizados WHERE id = ? AND empresa_id = ?',
      [req.params.id, req.empresaId]
    );
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Domínio não encontrado');
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});
