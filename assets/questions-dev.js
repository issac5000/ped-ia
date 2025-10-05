// Centralized development milestones (0–36 months)
// Flat ordered array of 30 items. The display groups are defined by index:
// 0–9   => 0–12 mois
// 10–19 => 12–24 mois
// 20–29 => 24–36 mois
// Keys are stable identifiers; labels are shown to users.
export const DEV_QUESTIONS = [
  // 0 – 12 mois
  { key: '0_12_smile_social', label: 'Sourit socialement' },
  { key: '0_12_hold_head', label: 'Tient sa tête' },
  { key: '0_12_roll_both', label: 'Roule du ventre au dos et inversement' },
  { key: '0_12_grasp_object', label: 'Attrape volontairement un objet' },
  { key: '0_12_sit_unaided', label: 'Se tient assis sans aide' },
  { key: '0_12_babble', label: 'Babille avec des sons (“ba-ba”, “da-da”)' },
  { key: '0_12_move_crawl', label: 'Se déplace (rampe ou 4 pattes)' },
  { key: '0_12_pull_to_stand', label: 'Se met debout en s’appuyant' },
  { key: '0_12_name_response', label: 'Réagit à son prénom' },
  { key: '0_12_wave_clap', label: 'Fait “au revoir” ou applaudit' },

  // 12 – 24 mois
  { key: '12_24_walk_alone', label: 'Marche seul' },
  { key: '12_24_stairs_hold', label: 'Monte quelques marches en se tenant' },
  { key: '12_24_run_no_fall', label: 'Court sans tomber' },
  { key: '12_24_tower_2_4', label: 'Construit une tour de 2-4 cubes' },
  { key: '12_24_spoon_cup', label: 'Utilise une cuillère ou boit dans un verre' },
  { key: '12_24_words_10_20', label: 'Dit 10 à 20 mots' },
  { key: '12_24_two_word_combo', label: 'Associe 2 mots (“encore eau”, “veux ballon”)' },
  { key: '12_24_point_body_parts', label: 'Montre des parties du corps sur demande' },
  { key: '12_24_follow_one_step', label: 'Suit une consigne simple' },
  { key: '12_24_simple_symbolic_play', label: 'Commence le jeu symbolique simple' },

  // 24 – 36 mois
  { key: '24_36_stairs_alternating', label: 'Monte et descend les escaliers en alternant les pieds' },
  { key: '24_36_jump_two_feet', label: 'Saute avec les deux pieds' },
  { key: '24_36_tower_6_8', label: 'Construit une tour de 6-8 cubes' },
  { key: '24_36_draw_circle_line', label: 'Dessine un cercle ou un trait vertical' },
  { key: '24_36_phrase_3_4', label: 'Forme des phrases de 3-4 mots' },
  { key: '24_36_basic_colors', label: 'Connaît les couleurs de base' },
  { key: '24_36_count_to_3', label: 'Compte jusqu’à 3 objets' },
  { key: '24_36_follow_two_step', label: 'Suit une consigne en 2 étapes' },
  { key: '24_36_play_with_others', label: 'Joue avec d’autres enfants (jeu parallèle → coopératif)' },
  { key: '24_36_start_toilet_training', label: 'Commence l’apprentissage de la propreté' }
];
