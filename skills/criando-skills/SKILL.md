---
name: criando-skills
description: Como escrever skills de alta qualidade. Use antes de criar ou melhorar qualquer skill com createSkill/updateSkill.
---

# Criando Skills de Qualidade

Uma skill e um procedimento documentado que voce ou outro agente vai reler no futuro, sem o contexto desta conversa. Escreva para esse leitor.

## Quando criar uma skill

- Voce completou uma tarefa complexa que provavelmente vai se repetir
- Voce descobriu um processo com varios passos nao obvios
- O usuario corrigiu sua abordagem e a licao vale para sempre

NAO crie skill para: tarefas triviais, fatos pontuais (isso vai para a memoria), ou algo que voce fez uma unica vez sem chance de repetir.

## Estrutura de uma boa skill

1. **description (frontmatter)**: uma frase dizendo O QUE ela faz e QUANDO usar. E por ela que se decide carregar a skill — seja especifico.
2. **Passos numerados**: acoes concretas, na ordem certa, com as ferramentas exatas a usar.
3. **Exemplos reais**: um exemplo de entrada e saida vale mais que tres paragrafos.
4. **Cuidados**: o que costuma dar errado e como evitar.

## Regras

- Escreva em portugues, direto, sem enrolacao
- Cada passo deve ser acionavel ("rode X", "leia Y", "verifique Z")
- Se a skill depende de arquivos auxiliares, coloque-os na pasta da skill e referencie pelo nome
- Ao usar uma skill e perceber um erro ou melhoria, atualize-a na hora com updateSkill
