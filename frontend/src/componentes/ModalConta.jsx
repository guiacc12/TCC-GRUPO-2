import { useState } from 'react';
import { api } from '../lib/api.js';
import { Botao, Campo, Modal, avisar } from './ui.jsx';

/**
 * Edição do próprio nome e senha. Em modo `obrigatorio` (senha temporária gerada pelo admin)
 * mostra só a troca de senha e não pode ser fechado — a saída é definir a senha ou encerrar a sessão.
 */
export default function ModalConta({ perfil, nomeAtual, obrigatorio = false, aoFechar, aoSalvar, aoSair }) {
  const [nome, setNome] = useState(nomeAtual || '');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const trocandoSenha = obrigatorio || novaSenha !== '' || senhaAtual !== '';
  const fechar = () => { if (!carregando) aoFechar(); };

  async function salvar(evento) {
    evento.preventDefault();
    if (carregando) return;
    setErro('');
    if (trocandoSenha && novaSenha !== confirmacao) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }

    const corpo = {
      ...(!obrigatorio && { nome: nome.trim() }),
      ...(trocandoSenha && { senha_atual: senhaAtual, nova_senha: novaSenha }),
    };
    setCarregando(true);
    try {
      const caminho = perfil === 'admin' ? '/api/admin/conta' : '/api/empresa/conta';
      const dados = await api(caminho, { metodo: 'PUT', perfil, corpo });
      avisar(dados.senha_alterada ? 'Senha atualizada.' : 'Dados atualizados.');
      aoSalvar({ nome: dados.nome, senhaAlterada: dados.senha_alterada });
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal aberto titulo={obrigatorio ? 'Defina uma nova senha' : 'Minha conta'} aoFechar={fechar} fechavel={!obrigatorio}>
      <form onSubmit={salvar} className="space-y-4">
        {obrigatorio ? (
          <p className="text-sm text-osso-suave">
            Você entrou com uma senha temporária. Para continuar usando o painel, defina uma senha pessoal.
          </p>
        ) : (
          <Campo
            rotulo="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            maxLength={160}
            disabled={carregando}
          />
        )}

        {!obrigatorio && (
          <p className="etiqueta pt-2">Alterar senha <span className="normal-case tracking-normal">(opcional)</span></p>
        )}
        <Campo
          rotulo={obrigatorio ? 'Senha temporária' : 'Senha atual'}
          type="password"
          value={senhaAtual}
          onChange={(e) => setSenhaAtual(e.target.value)}
          required={trocandoSenha}
          autoComplete="current-password"
          disabled={carregando}
          autoFocus={obrigatorio}
        />
        <div className="grid grid-cols-2 gap-4">
          <Campo
            rotulo="Nova senha"
            type="password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            required={trocandoSenha}
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            dica="Mínimo de 8 caracteres"
            disabled={carregando}
          />
          <Campo
            rotulo="Confirmar nova senha"
            type="password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            required={trocandoSenha}
            autoComplete="new-password"
            disabled={carregando}
          />
        </div>

        {erro && <p role="alert" className="text-sm text-estado-erro">{erro}</p>}

        <div className="flex justify-end gap-3 pt-2">
          {obrigatorio ? (
            <Botao variante="sutil" type="button" onClick={aoSair} disabled={carregando}>Encerrar sessão</Botao>
          ) : (
            <Botao variante="sutil" type="button" onClick={fechar} disabled={carregando}>Cancelar</Botao>
          )}
          <Botao type="submit" carregando={carregando}>{obrigatorio ? 'Definir senha' : 'Salvar'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
