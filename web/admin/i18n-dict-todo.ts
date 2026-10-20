// Microsoft To Do lists on the Tareas page (#15) and their activity entries. Admin text keyed by the Spanish string t()
// takes. Each row is [es, en, pt, nl, da]. ROWS_TODO feeds EN and PT (i18n-dict.ts); NL_TODO and DA_TODO are spread
// into NL and DA. Microsoft names the app "Microsoft To Do" in every language.
const ROWS: [string, string, string, string, string][] = [
  ['Listas de Microsoft To Do', 'Microsoft To Do lists', 'Listas do Microsoft To Do', 'Microsoft To Do-lijsten', 'Microsoft To Do-lister'],
  [
    'Las tareas pendientes de las listas que elijas salen junto a las de aquí, con su fecha y una estrella si son importantes. Se actualizan cada 5 minutos.',
    'The open tasks of the lists you pick show next to the ones here, with their due date and a star when they are important. They update every 5 minutes.',
    'As tarefas pendentes das listas que escolheres aparecem junto às daqui, com a data e uma estrela se forem importantes. Atualizam-se a cada 5 minutos.',
    'De open taken van de lijsten die je kiest staan naast die van hier, met hun datum en een ster als ze belangrijk zijn. Ze worden elke 5 minuten bijgewerkt.',
    'De åbne opgaver fra de lister, du vælger, vises sammen med dem her, med deres dato og en stjerne, hvis de er vigtige. De opdateres hvert 5. minut.',
  ],
  ['Ninguna cuenta de Microsoft vinculada', 'No Microsoft account linked', 'Nenhuma conta Microsoft associada', 'Geen Microsoft-account gekoppeld', 'Ingen Microsoft-konto tilknyttet'],
  ['Vincula tu cuenta de Microsoft en', 'Link your Microsoft account in', 'Associa a tua conta Microsoft em', 'Koppel je Microsoft-account bij', 'Tilknyt din Microsoft-konto under'],
  [
    'Vuelve a vincular la cuenta para ver tus listas de To Do.',
    'Reconnect to see your To Do lists.',
    'Volta a associar a conta para veres as tuas listas do To Do.',
    'Koppel het account opnieuw om je To Do-lijsten te zien.',
    'Tilknyt kontoen igen for at se dine To Do-lister.',
  ],
  ['Volver a vincular', 'Reconnect', 'Voltar a associar', 'Opnieuw koppelen', 'Tilknyt igen'],
  [
    'No se pudieron leer las listas de To Do. Inténtalo más tarde.',
    'Could not read the To Do lists. Try again later.',
    'Não foi possível ler as listas do To Do. Tenta mais tarde.',
    'De To Do-lijsten konden niet worden gelezen. Probeer het later opnieuw.',
    'To Do-listerne kunne ikke læses. Prøv igen senere.',
  ],
  ['Esta cuenta no tiene listas de To Do.', 'This account has no To Do lists.', 'Esta conta não tem listas do To Do.', 'Dit account heeft geen To Do-lijsten.', 'Denne konto har ingen To Do-lister.'],
  ['Compartida', 'Shared', 'Partilhada', 'Gedeeld', 'Delt'],
  [
    'Una tarea de To Do tocada en la pantalla se marca como hecha también en Microsoft. Es el mismo ajuste que el de las rutinas de Familia. No funciona en modo privado.',
    'A To Do task tapped on the screen is marked done in Microsoft too. It is the same setting as for the Family routines. It does not work in private mode.',
    'Uma tarefa do To Do tocada no ecrã fica feita também na Microsoft. É a mesma definição das rotinas da Família. Não funciona no modo privado.',
    'Een To Do-taak die je op het scherm aantikt, wordt ook bij Microsoft afgevinkt. Het is dezelfde instelling als voor de routines van Gezin. Werkt niet in privémodus.',
    'En To Do-opgave, du trykker på skærmen, markeres også som udført hos Microsoft. Det er samme indstilling som for Familiens rutiner. Virker ikke i privat tilstand.',
  ],
  [
    'Estas listas solo se pueden leer: vuelve a vincular la cuenta para poder marcarlas desde la pantalla.',
    'These lists can only be read: reconnect the account to tick them from the screen.',
    'Estas listas só podem ser lidas: volta a associar a conta para as marcares no ecrã.',
    'Deze lijsten kunnen alleen worden gelezen: koppel het account opnieuw om ze op het scherm af te vinken.',
    'Disse lister kan kun læses: tilknyt kontoen igen for at markere dem fra skærmen.',
  ],
  ['Esa es otra cuenta. Entra como {email}.', 'That is a different account. Sign in as {email}.', 'Essa é outra conta. Entra como {email}.', 'Dat is een ander account. Log in als {email}.', 'Det er en anden konto. Log ind som {email}.'],
  [
    'Esa es otra cuenta. Entra con la cuenta que querías volver a vincular.',
    'That is a different account. Sign in with the account you wanted to reconnect.',
    'Essa é outra conta. Entra com a conta que querias voltar a associar.',
    'Dat is een ander account. Log in met het account dat je opnieuw wilde koppelen.',
    'Det er en anden konto. Log ind med den konto, du ville tilknytte igen.',
  ],
  ['Tarea hecha: {task}', 'Task done: {task}', 'Tarefa feita: {task}', 'Taak gedaan: {task}', 'Opgave udført: {task}'],
  ['Tarea desmarcada: {task}', 'Task unticked: {task}', 'Tarefa desmarcada: {task}', 'Taak niet meer afgevinkt: {task}', 'Opgave ikke længere udført: {task}'],
];

export const ROWS_TODO: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_TODO: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_TODO: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
