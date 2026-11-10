async function loadDemo() {
  const status = document.querySelector('#status');
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error('Demonstração indisponível');
    const demo = await response.json();
    for (const fixture of demo.fixtures) {
      const article = document.createElement('article');
      const title = document.createElement('h3');
      const home = demo.teams.find(team => team.id === fixture.homeTeamId);
      const away = demo.teams.find(team => team.id === fixture.awayTeamId);
      title.textContent = `${home.name} × ${away.name}`;
      const date = document.createElement('p');
      date.textContent = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
      }).format(new Date(fixture.scheduledAt));
      article.append(title, date);
      for (const team of [home, away]) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `Escalação: ${team.name}`;
        const list = document.createElement('ul');
        for (const player of fixture.lineups.filter(player => player.teamId === team.id)) {
          const item = document.createElement('li');
          item.textContent = `${player.name} · ${player.position} · overall ${player.overall}`;
          list.append(item);
        }
        details.append(summary, list);
        article.append(details);
      }
      document.querySelector('#fixtures').append(article);
    }
    status.textContent = `${demo.fixtures.length} partidas prontas para demonstração.`;
  } catch {
    status.textContent = 'Não foi possível carregar a demonstração. Recarregue a página para tentar novamente.';
  }
}
loadDemo();
