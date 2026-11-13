import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { banco } from '../config/banco.js';
import { ErroHttp } from '../middlewares/erros.js';

// bcrypt ignora o que passa de 72 bytes — limitar evita senha "longa" que na prática é truncada
const esquemaConta = z
  .object({
    nome: z.string().trim().min(2).max(160).optional(),
    senha_atual: z.string().min(1).optional(),
    nova_senha: z.string().min(8).max(72).optional(),
  })
  .refine((d) => d.nome || d.nova_senha, { message: 'Nada para alterar' })
  .refine((d) => !d.nova_senha || d.senha_atual, { message: 'Informe a senha atual', path: ['senha_atual'] })
  .refine((d) => !d.nova_senha || d.nova_senha !== d.senha_atual, {
    message: 'A nova senha precisa ser diferente da atual',
    path: ['nova_senha'],
  });

/**
 * Edição do próprio nome/senha. A senha atual é sempre exigida para trocar a senha —
 * inclusive no fluxo de senha temporária, para que um token antigo não baste para assumir a conta.
 */
function criarAtualizacaoDeConta({ tabela, idDaRequisicao, zerarTrocaObrigatoria }) {
  return async (req, res, next) => {
    try {
      const dados = esquemaConta.parse(req.body);
      const id = req[idDaRequisicao];

      const [linhas] = await banco.query(`SELECT nome, senha_hash FROM ${tabela} WHERE id = ?`, [id]);
      const conta = linhas[0];
      if (!conta) throw new ErroHttp(404, 'Conta não encontrada');

      let senhaHash = null;
      if (dados.nova_senha) {
        // 422 e não 401: o painel trata 401 como sessão expirada e derrubaria o usuário
        if (!(await bcrypt.compare(dados.senha_atual, conta.senha_hash))) {
          throw new ErroHttp(422, 'Senha atual incorreta');
        }
        senhaHash = await bcrypt.hash(dados.nova_senha, 10);
      }

      const nome = dados.nome ?? conta.nome;
      const limparTroca = zerarTrocaObrigatoria && senhaHash ? ', deve_trocar_senha = 0' : '';
      await banco.query(
        `UPDATE ${tabela} SET nome = ?, senha_hash = COALESCE(?, senha_hash)${limparTroca} WHERE id = ?`,
        [nome, senhaHash, id]
      );

      res.json({ sucesso: true, nome, senha_alterada: Boolean(senhaHash) });
    } catch (erro) {
      next(erro);
    }
  };
}

export const atualizarContaAdmin = criarAtualizacaoDeConta({
  tabela: 'super_admins',
  idDaRequisicao: 'adminId',
  zerarTrocaObrigatoria: false,
});

// Montado em /api/empresa/conta, depois de autenticarEmpresa
export const rotasContaEmpresa = Router();
rotasContaEmpresa.put(
  '/',
  criarAtualizacaoDeConta({ tabela: 'usuarios', idDaRequisicao: 'usuarioId', zerarTrocaObrigatoria: true })
);
