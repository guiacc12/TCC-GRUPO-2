import { createContext, useContext, useEffect, useState } from 'react';

const TemaContexto = createContext(null);
const CHAVE_ARMAZENAMENTO = 'leadflow:tema';

function temaInicial() {
  try {
    const salvo = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (salvo === 'claro' || salvo === 'escuro') return salvo;
  } catch {
    // localStorage indisponível (modo privado etc.) — segue com o padrão
  }
  return 'escuro';
}

export function TemaProvider({ children }) {
  const [tema, setTema] = useState(temaInicial);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    try {
      localStorage.setItem(CHAVE_ARMAZENAMENTO, tema);
    } catch {
      // ignora falha de persistência
    }
  }, [tema]);

  const alternarTema = () => setTema((atual) => (atual === 'escuro' ? 'claro' : 'escuro'));

  return <TemaContexto.Provider value={{ tema, alternarTema }}>{children}</TemaContexto.Provider>;
}

export function useTema() {
  const contexto = useContext(TemaContexto);
  if (!contexto) throw new Error('useTema precisa estar dentro de <TemaProvider>');
  return contexto;
}
