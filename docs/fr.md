# OpenThread Border Router

Un **OpenThread Border Router** (ot-br-posix) qui fonctionne déjà sur votre
réseau, lu par Gladys par son API REST locale. Pratique pour voir d’un coup
d’œil, ou dans une scène, que le réseau Thread de la maison fonctionne, quel
rôle tient le routeur de bordure et combien de routeurs Thread il compte :

- le routeur de bordure devient un appareil Gladys (onglet Découverte) :
  **Thread role** (rôle Thread : leader, routeur, enfant, détaché ou
  désactivé), **Thread network up** (réseau Thread actif : oui / non ; oui pour
  leader, routeur ou enfant), **Thread routers** (les routeurs de la partition
  Thread que le routeur de bordure connaît), **Thread network name** (nom du
  réseau), **Thread channel** (canal), **Thread PAN ID**, **Thread extended
  PAN ID** (PAN ID étendu), **Active dataset present** (jeu de données actif
  présent : oui / non) et **Last action** (dernière action : le résultat de la
  dernière action Thread envoyée depuis Gladys) ;
- deux boutons de l’écran de configuration, **Désactiver Thread** et
  **Activer Thread**, chacun refusé tant que vous ne l’autorisez pas.

La radio Thread reste sur le routeur de bordure : Gladys ne parle jamais
Thread lui-même et n’appaire aucun appareil Thread. Vos appareils Thread
arrivent dans Gladys par **Matter** (le service Matter de Gladys), pas par
cette intégration.

> **Cette intégration n’a jamais été testée avec un vrai routeur de bordure.**
> Cette première version suit l’API REST d’ot-br-posix (son `openapi.yaml`) et
> la bibliothèque python-otbr-api de Home Assistant ; elle a été testée contre
> un faux serveur et contre ot-br-posix lancé dans Docker avec une radio Thread
> **simulée** (pas de vraie radio, pas de vrai appareil Thread). Dites sur le
> forum Gladys ce qui marche et ce qui ne marche pas, avec votre routeur de
> bordure (module Home Assistant, Raspberry Pi, autre).

Intégration non officielle, sans lien avec le projet OpenThread ni Google.

## Avant de commencer

1. Le routeur de bordure doit faire tourner **ot-br-posix** avec son **API
   REST** (port **8081** par défaut, `--rest-listen-address` /
   `--rest-listen-port`). Elle n’a ni HTTPS ni connexion : gardez-la sur votre
   réseau local.
2. **Home Assistant OS** : le module « OpenThread Border Router » ne sert
   l’API REST qu’à Home Assistant ; ouvrez son port **8081** dans les réglages
   « Réseau » du module pour que Gladys l’atteigne.
3. **Raspberry Pi** ou autre machine Linux : l’API REST écoute sur l’adresse
   donnée à `otbr-agent` (`--rest-listen-address`) ; il faut que Gladys puisse
   la joindre.
4. Vérifiez depuis un ordinateur du réseau : `http://<adresse>:8081/node` doit
   répondre un petit JSON avec `"state"` (ou `"State"`).

Les routeurs de bordure dont l’API REST ne donne pas leur **identifiant
d’agent de bordure** (border agent ID, ot-br-posix très ancien) sont refusés :
l’identifiant de l’appareil est cet ID, pour qu’un autre routeur de bordure
qui répondrait à la même adresse ne soit jamais pris pour celui-ci.

## Configuration

- **Adresse du routeur de bordure** : son adresse IP locale (ou son nom
  d’hôte), avec le port après deux-points quand ce n’est pas 8081
  (`192.168.1.30:8081`, `[fd00::30]:8081`). `http://` peut être saisi ;
  `https://` est refusé (l’API REST n’en a pas).
- **Rafraîchissement** : 1, 5 (par défaut), 15 ou 30 minutes. Le bouton de
  test, l’enregistrement du formulaire avec la même adresse, une reconnexion à
  Gladys ou un redémarrage ne lisent jamais plus tôt (une nouvelle adresse est
  lue tout de suite) (l’heure de la dernière lecture est
  gardée dans `/data`, quand `/data` est lisible) ; la fin d’une action Thread avance une lecture.
- **Autoriser les actions Thread** (désactivé par défaut) : voir plus bas.

## Ce qui est lu

Chaque lecture fait deux requêtes, l’une après l’autre, chacune sur sa propre
connexion, 5 secondes et 64 Ko au plus chacune :

- `GET /node` : le rôle, les routeurs, l’identifiant d’agent de bordure et
  (quand le routeur de bordure est rattaché) le nom du réseau et le PAN ID
  étendu ;
- `GET /node/dataset/active` : le jeu de données actif, dont **seuls** le
  canal, le PAN ID, le PAN ID étendu, le nom du réseau et son horodatage sont
  extraits. **La clé réseau et le PSKc ne sont jamais gardés, jamais
  journalisés, jamais affichés, jamais publiés, jamais écrits dans `/data`.**
  Un échec de cette requête laisse ces valeurs hors de cette lecture (non
  publiées) ; il n’arrête jamais la lecture.

Un routeur de bordure dont Thread est **désactivé** ou **détaché** répond
encore son dernier nom de réseau dans `/node` (souvent « OpenThread » par
défaut) : ce sont alors le nom et le PAN ID étendu du jeu de données actif qui
sont affichés. Sans jeu de données actif, « Active dataset present » vaut
« non » et le canal, le PAN ID et le nom restent inconnus (jamais 0).

Une valeur que le routeur de bordure ne donne pas reste inconnue dans Gladys :
elle n’est jamais publiée comme 0.

« Thread routers » est ce que le routeur de bordure connaît lui-même (le
`routerCount` / `NumOfRouter` de `/node`), publié seulement quand il est
rattaché (détaché ou désactivé, ce nombre est un reste de sa dernière
partition : laissé inconnu). Les appareils terminaux (capteurs
endormis, enfants) ne sont pas comptés : les compter demande un diagnostic
réseau envoyé à chaque nœud du réseau, qui réveille les appareils sur pile ;
cette première version ne l’envoie pas.

## Actions Thread

**Désactiver Thread sur le routeur de bordure coupe tous les appareils Thread
de son réseau** (lampes, capteurs, serrures, volets joints par lui) jusqu’à ce
que Thread soit réactivé. Donc :

- les deux actions sont des **boutons de l’écran de configuration** de
  l’intégration, jamais une fonction de l’appareil : aucun interrupteur, aucun
  bouton dans une scène, aucun assistant vocal ni « tout éteindre » ne peut
  les atteindre ;
- elles sont **refusées** (rien lu, rien envoyé) tant que **Autoriser les
  actions Thread** est désactivé, ce qui est le réglage par défaut ;
- **deux clics** : le premier clic relit le routeur de bordure et dit ce qu’il
  est (la fin de son identifiant d’agent de bordure, le nom du réseau, son
  rôle, ses routeurs) et, pour « Désactiver Thread », ce que la désactivation
  coupe ; le second clic, **dans les 2 minutes**, relit encore le routeur de
  bordure et n’envoie que si **le même routeur de bordure** répond (même
  identifiant) et que Thread n’est pas déjà dans l’état demandé. Désactiver
  l’option annule un premier clic ; l’option est revérifiée juste avant
  l’écriture de la requête ;
- la requête est `PUT /node/state` avec `"disable"` ou `"enable"` (ce que font
  `ot-ctl thread stop` / `thread start`). Elle ne part jamais plus de
  20 secondes après le second clic ;
- le résultat est relu (`GET /node/state`, trois fois au plus : 1 seconde
  après la réponse, puis 2 secondes plus tard, puis 4 secondes plus tard) :
  - **Thread désactivé (confirmé)** / **Thread activé** quand le rôle relu
    montre le changement (activé : tout rôle sauf « disabled » ; le routeur de
    bordure passe d’abord par « detached ») ;
  - **Envoyé, pas encore appliqué** quand le rôle relu est encore celui
    d’avant ;
  - **Envoyé, sans confirmation** quand le routeur de bordure n’a pas répondu
    à la requête (il a pu l’appliquer) ;
  - **Refusé par le routeur de bordure (HTTP …)** quand il a répondu une
    erreur (HTTP 4xx ou 5xx) ;
  - **Rien envoyé (…)** quand la requête n’est jamais partie.

  Le résultat (sauf « Rien envoyé ») est gardé comme « Last action » (et dans
  `/data`), et une lecture suit : 1 seconde après une action confirmée,
  20 secondes après « pas encore appliqué », « sans confirmation » ou un refus
  du routeur de bordure (une erreur peut venir après le changement de Thread).
  Un 429 ou 5xx répondu à la lecture d’un clic met en pause comme celui d’une
  lecture.

- une action à la fois ; une lecture en cours est coupée par une action.

Chaque refus d’une action, et la liste de ce qui la fait refuser :

- « Autoriser les actions Thread » désactivé (aussi quand il est désactivé
  entre les deux clics, ou pendant l’écriture de la requête) ;
- la configuration pas encore relue depuis Gladys après une reconnexion
  (l’option a pu changer entre-temps ; vérifié aussi pendant l’écriture de la
  requête) ;
- l’adresse du routeur de bordure invalide ;
- une autre action Thread en cours ;
- une pause demandée par le routeur de bordure (HTTP 429 ou 5xx sur `/node`)
  pas encore finie ;
- le routeur de bordure non lu (pas de connexion, délai dépassé, erreur, pas un
  routeur de bordure), ou lu sans identifiant d’agent de bordure ;
- Thread déjà dans l’état demandé ;
- plus de 20 secondes entre le second clic et le moment où la requête serait
  écrite.

Gladys ne désactive ni n’active jamais Thread de lui-même.

## État et erreurs

L’écran de configuration dit l’état du routeur de bordure (« Connecté : rôle
Thread leader, 3 routeur(s) Thread », « Thread est désactivé sur le routeur de
bordure »), ou pourquoi il n’a pas été lu (« pas de connexion », « pas de
réponse à temps », « erreur HTTP 500 », « pas l’API REST d’un routeur de
bordure ») et quand vient le prochain essai.

Un routeur de bordure qui répond **HTTP 429 ou 5xx sur `/node`** demande
d’attendre : Gladys attend ce que dit son en-tête `Retry-After`, 60 secondes
au moins et 6 heures au plus (et jamais moins que le rafraîchissement), gardé
dans `/data` à travers un redémarrage ; les actions Thread sont refusées
pendant ce temps. Un 5xx sur le jeu de données ou sur `/node/ba-id` ne met
rien en pause.

## Vie privée et sécurité

- Pas de compte, pas de cloud : tout reste entre Gladys et le routeur de
  bordure, sur votre réseau.
- L’API REST d’ot-br-posix n’a ni connexion ni HTTPS : n’importe qui sur votre
  réseau peut la lire, et **n’importe qui sur votre réseau peut désactiver
  Thread par elle**, avec ou sans Gladys. Gardez-la sur un réseau de
  confiance.
- Du jeu de données actif, seul ce que tout routeur Thread diffuse de toute
  façon dans ses balises (nom du réseau, canal, PAN ID, PAN ID étendu) est
  utilisé.
- `/data/otbr-state.json` (0600) garde l’heure de la dernière lecture et
  l’adresse lue, une pause demandée par le routeur de bordure, et la dernière
  action avec son résultat. Rien d’autre.

## Limites de cette première version

- Jamais testée avec un vrai routeur de bordure ni un vrai appareil Thread
  (voir l’avertissement plus haut).
- Un routeur de bordure par intégration.
- Pas de comptage des appareils terminaux (voir « Ce qui est lu »).
- Pas d’écriture du jeu de données (former ou modifier un réseau Thread), pas
  de remise à zéro, pas de mise en service d’appareils Thread.
