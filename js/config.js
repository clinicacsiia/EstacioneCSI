/* ============================================================
   config.js — ONDE FICA O BANCO DE DADOS DO SISTEMA (Supabase)
   ------------------------------------------------------------
   Preencha as duas linhas abaixo com os dados do seu projeto:
     Supabase > Project Settings > API
       - Project URL                      (ex.: https://abcdefgh.supabase.co)
       - Publishable key (sb_publishable_...)

   Pode ficar público no GitHub: a chave "publishable" foi feita para ficar no
   navegador e, sozinha, NÃO dá acesso a nenhum dado. As tabelas ficam trancadas e a
   única porta de entrada (a função estaciona_api) exige usuário e senha do sistema.
   NUNCA coloque aqui a chave "secret" nem a "service_role".
   Passo a passo: supabase/LEIA-ME.md
   ============================================================ */
window.ESTACIONA_SUPABASE_URL = 'https://fzrzkcqeqptgzfrchuod.supabase.co';
window.ESTACIONA_SUPABASE_KEY = 'sb_publishable_iC8RJosZ3qtembtNw0QkeA_HCEi975H';
