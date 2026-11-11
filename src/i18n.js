// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, buttons, errors), as
// { en, fr }. No text ever holds an entry typed by the user nor a byte of the
// active dataset; the network name, the role and the end of the border agent
// id (public, read from the router) may be shown.
// -----------------------------------------------------------------------------

import { CODES } from './otbr/errors.js';

/** A delay in words: seconds under a minute, then whole minutes, then hours. */
export function delayOf(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds < 60) return { en: `${seconds} s`, fr: `${seconds} s` };
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return { en: `${minutes} min`, fr: `${minutes} min` };
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

/** Why the border router failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.LATE:
      return { en: 'too late to send', fr: 'trop tard pour envoyer' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return {
        en: 'not the REST API of a border router',
        fr: 'pas l’API REST d’un routeur de bordure',
      };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.REDIRECT:
      return { en: 'redirection', fr: 'redirection' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const ROLE_FR = {
  disabled: 'désactivé',
  detached: 'détaché',
  child: 'enfant',
  router: 'routeur',
  leader: 'leader',
};
export const roleText = (role) => ({ en: role, fr: ROLE_FR[role] ?? role });

/** The end of the border agent id, enough to tell two routers apart. */
const shortId = (baId) => `…${String(baId).slice(-8)}`;

const of = (en, fr) => ({ en, fr });

export const T = {
  status: {
    missingHost: of(
      'Type the address of the border router in the configuration.',
      'Saisissez l’adresse du routeur de bordure dans la configuration.',
    ),
    invalidHost: of(
      'The address of the border router is not valid (an IP address or a host name, an optional port; http only).',
      'L’adresse du routeur de bordure n’est pas valide (une adresse IP ou un nom d’hôte, un port facultatif ; http seulement).',
    ),
    configNotRead: (ms) => {
      const d = delayOf(ms);
      return of(
        `The configuration could not be read from Gladys; asked again in ${d.en}.`,
        `La configuration n’a pas pu être lue depuis Gladys ; redemandée dans ${d.fr}.`,
      );
    },
    waiting: of('Connecting to the border router…', 'Connexion au routeur de bordure…'),
    connected: (node) => {
      if (node.role === 'disabled') {
        return of(
          'Connected: Thread is disabled on the border router.',
          'Connecté : Thread est désactivé sur le routeur de bordure.',
        );
      }
      const r = roleText(node.role);
      // Detached, the count of /node is a leftover of the last partition.
      const routers = node.role === 'detached' ? null : node.routers;
      return of(
        `Connected: Thread role ${r.en}${routers === null ? '' : `, ${routers} Thread router(s)`}.`,
        `Connecté : rôle Thread ${r.fr}${routers === null ? '' : `, ${routers} routeur(s) Thread`}.`,
      );
    },
    failed: (err, ms) => {
      const r = reasonOf(err);
      const d = delayOf(ms);
      return of(
        `Border router not read (${r.en}); next try in ${d.en}.`,
        `Routeur de bordure non lu (${r.fr}) ; prochain essai dans ${d.fr}.`,
      );
    },
    paused: (status, ms) => {
      const d = delayOf(ms);
      return of(
        `The border router asked to wait (HTTP ${status}); next reading in ${d.en}.`,
        `Le routeur de bordure a demandé d’attendre (HTTP ${status}) ; prochaine lecture dans ${d.fr}.`,
      );
    },
    noBaId: (ms) => {
      const d = delayOf(ms);
      return of(
        `The border router does not give its border agent ID (ot-br-posix too old?): nothing published; next try in ${d.en}.`,
        `Le routeur de bordure ne donne pas son identifiant d’agent de bordure (ot-br-posix trop ancien ?) : rien publié ; prochain essai dans ${d.fr}.`,
      );
    },
  },
  test: {
    notDue: (status, ms) => {
      const d = delayOf(ms);
      return of(
        `${status.en} Next reading in ${d.en} (never sooner than the refresh).`,
        `${status.fr} Prochaine lecture dans ${d.fr} (jamais avant le rafraîchissement).`,
      );
    },
  },
  action: {
    notAllowed: of(
      'Refused: Thread actions are off. Turn on “Allow Thread actions” in the configuration. Nothing sent.',
      'Refusé : les actions Thread sont désactivées. Activez « Autoriser les actions Thread » dans la configuration. Rien envoyé.',
    ),
    invalidHost: of(
      'Refused: the address of the border router is not valid. Nothing sent.',
      'Refusé : l’adresse du routeur de bordure n’est pas valide. Rien envoyé.',
    ),
    busy: of(
      'Refused: another Thread action is running. Nothing sent.',
      'Refusé : une autre action Thread est en cours. Rien envoyé.',
    ),
    paused: (status, ms) => {
      const d = delayOf(ms);
      return of(
        `Refused: the border router asked to wait (HTTP ${status}), ${d.en} left. Nothing sent.`,
        `Refusé : le routeur de bordure a demandé d’attendre (HTTP ${status}), encore ${d.fr}. Rien envoyé.`,
      );
    },
    notRead: (err) => {
      const r = reasonOf(err);
      return of(
        `The border router could not be read (${r.en}). Nothing sent.`,
        `Le routeur de bordure n’a pas pu être lu (${r.fr}). Rien envoyé.`,
      );
    },
    noBaId: of(
      'The border router does not give its border agent ID: it cannot be told apart from another one. Nothing sent.',
      'Le routeur de bordure ne donne pas son identifiant d’agent de bordure : impossible de le distinguer d’un autre. Rien envoyé.',
    ),
    already: (kind, role) => {
      const r = roleText(role);
      return kind === 'disable'
        ? of('Thread is already disabled. Nothing sent.', 'Thread est déjà désactivé. Rien envoyé.')
        : of(
            `Thread is already enabled (role: ${r.en}). Nothing sent.`,
            `Thread est déjà activé (rôle : ${r.fr}). Rien envoyé.`,
          );
    },
    confirm: (kind, node, other) => {
      const r = roleText(node.role);
      const name = node.networkName ? ` “${node.networkName}”` : '';
      const attached = ['child', 'router', 'leader'].includes(node.role);
      const routers = node.routers === null || !attached ? '' : `, ${node.routers}`;
      const who = other
        ? of(
            `Another border router answers at this address now (ID ${shortId(node.baId)}).`,
            `Un autre routeur de bordure répond maintenant à cette adresse (ID ${shortId(node.baId)}).`,
          )
        : of(
            `Border router ID ${shortId(node.baId)}, network${name}, role ${r.en}${routers ? `${routers} Thread router(s)` : ''}.`,
            `Routeur de bordure ID ${shortId(node.baId)}, réseau${name}, rôle ${r.fr}${routers ? `${routers} routeur(s) Thread` : ''}.`,
          );
      return kind === 'disable'
        ? of(
            `${who.en} Disabling Thread cuts every Thread device of this network (lights, sensors, locks reached through it). Click again within 2 minutes to disable Thread.`,
            `${who.fr} Désactiver Thread coupe tous les appareils Thread de ce réseau (lampes, capteurs, serrures joints par lui). Cliquez de nouveau dans les 2 minutes pour désactiver Thread.`,
          )
        : of(
            `${who.en} Click again within 2 minutes to enable Thread.`,
            `${who.fr} Cliquez de nouveau dans les 2 minutes pour activer Thread.`,
          );
    },
    notSent: (err) => {
      const r = reasonOf(err);
      return of(`Nothing sent (${r.en}).`, `Rien envoyé (${r.fr}).`);
    },
    optionOff: of(
      'Nothing sent: “Allow Thread actions” was turned off meanwhile.',
      'Rien envoyé : « Autoriser les actions Thread » a été désactivé entre-temps.',
    ),
    tooLate: of(
      'Nothing sent: the border router was read too slowly to send in time. Try again.',
      'Rien envoyé : le routeur de bordure a été lu trop lentement pour envoyer à temps. Réessayez.',
    ),
    refused: (status) =>
      of(
        `Refused by the border router (HTTP ${status}).`,
        `Refusé par le routeur de bordure (HTTP ${status}).`,
      ),
    noAnswer: of(
      'Sent, without confirmation: the border router did not answer. Read again in 20 s.',
      'Envoyé, sans confirmation : le routeur de bordure n’a pas répondu. Relu dans 20 s.',
    ),
    confirmed: (kind, role) => {
      const r = roleText(role);
      return kind === 'disable'
        ? of('Thread disabled (confirmed).', 'Thread désactivé (confirmé).')
        : of(`Thread enabled (role: ${r.en}).`, `Thread activé (rôle : ${r.fr}).`);
    },
    unconfirmed: (role) => {
      const r = roleText(role ?? 'unknown');
      return of(
        `Sent, not applied yet (role read: ${r.en}). Read again in 20 s.`,
        `Envoyé, pas encore appliqué (rôle lu : ${r.fr}). Relu dans 20 s.`,
      );
    },
  },
  errors: {
    stopped: 'The integration is stopping',
  },
};
