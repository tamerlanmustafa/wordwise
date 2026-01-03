import type { BookCardData } from '../components/BookCard';

// Top 20 most popular books from Project Gutenberg
// Cover URLs from covers.openlibrary.org using cover IDs
export const POPULAR_BOOKS: BookCardData[] = [
  {
    gutenbergId: 1342,
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    coverUrl: 'https://covers.openlibrary.org/b/id/14348537-M.jpg'
  },
  {
    gutenbergId: 84,
    title: 'Frankenstein',
    author: 'Mary Shelley',
    coverUrl: 'https://covers.openlibrary.org/b/id/12356249-M.jpg'
  },
  {
    gutenbergId: 1661,
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    coverUrl: 'https://covers.openlibrary.org/b/id/6717853-M.jpg'
  },
  {
    gutenbergId: 11,
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    coverUrl: 'https://covers.openlibrary.org/b/id/10527843-M.jpg'
  },
  {
    gutenbergId: 1232,
    title: 'The Prince',
    author: 'Niccolò Machiavelli',
    coverUrl: 'https://covers.openlibrary.org/b/id/12726168-M.jpg'
  },
  {
    gutenbergId: 98,
    title: 'A Tale of Two Cities',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/13301713-M.jpg'
  },
  {
    gutenbergId: 2701,
    title: 'Moby Dick',
    author: 'Herman Melville',
    coverUrl: 'https://covers.openlibrary.org/b/id/10544254-M.jpg'
  },
  {
    gutenbergId: 345,
    title: 'Dracula',
    author: 'Bram Stoker',
    coverUrl: 'https://covers.openlibrary.org/b/id/12216503-M.jpg'
  },
  {
    gutenbergId: 74,
    title: 'The Adventures of Tom Sawyer',
    author: 'Mark Twain',
    coverUrl: 'https://covers.openlibrary.org/b/id/12043351-M.jpg'
  },
  {
    gutenbergId: 1400,
    title: 'Great Expectations',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/13322313-M.jpg'
  },
  {
    gutenbergId: 16328,
    title: 'Beowulf',
    author: 'Unknown',
    coverUrl: 'https://covers.openlibrary.org/b/id/250016-M.jpg'
  },
  {
    gutenbergId: 1952,
    title: 'The Yellow Wallpaper',
    author: 'Charlotte Perkins Gilman',
    coverUrl: 'https://covers.openlibrary.org/b/id/12096609-M.jpg'
  },
  {
    gutenbergId: 2542,
    title: "A Doll's House",
    author: 'Henrik Ibsen',
    coverUrl: 'https://covers.openlibrary.org/b/id/879914-M.jpg'
  },
  {
    gutenbergId: 1080,
    title: 'A Modest Proposal',
    author: 'Jonathan Swift',
    coverUrl: 'https://covers.openlibrary.org/b/id/10843559-M.jpg'
  },
  {
    gutenbergId: 46,
    title: 'A Christmas Carol',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/13299222-M.jpg'
  },
  {
    gutenbergId: 174,
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    coverUrl: 'https://covers.openlibrary.org/b/id/14314858-M.jpg'
  },
  {
    gutenbergId: 768,
    title: 'Wuthering Heights',
    author: 'Emily Brontë',
    coverUrl: 'https://covers.openlibrary.org/b/id/12818862-M.jpg'
  },
  {
    gutenbergId: 1260,
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    coverUrl: 'https://covers.openlibrary.org/b/id/8235363-M.jpg'
  },
  {
    gutenbergId: 35,
    title: 'The Time Machine',
    author: 'H. G. Wells',
    coverUrl: 'https://covers.openlibrary.org/b/id/9009316-M.jpg'
  },
  {
    gutenbergId: 36,
    title: 'The War of the Worlds',
    author: 'H. G. Wells',
    coverUrl: 'https://covers.openlibrary.org/b/id/36314-M.jpg'
  }
];

// Classic authors section
export const CLASSIC_AUTHORS: BookCardData[] = [
  {
    gutenbergId: 1399,
    title: 'Anna Karenina',
    author: 'Leo Tolstoy',
    coverUrl: 'https://covers.openlibrary.org/b/id/12818827-M.jpg'
  },
  {
    gutenbergId: 2600,
    title: 'War and Peace',
    author: 'Leo Tolstoy',
    coverUrl: 'https://covers.openlibrary.org/b/id/12621906-M.jpg'
  },
  {
    gutenbergId: 2554,
    title: 'Crime and Punishment',
    author: 'Fyodor Dostoyevsky',
    coverUrl: 'https://covers.openlibrary.org/b/id/14911181-M.jpg'
  },
  {
    gutenbergId: 28054,
    title: 'The Brothers Karamazov',
    author: 'Fyodor Dostoyevsky',
    coverUrl: 'https://covers.openlibrary.org/b/id/12738482-M.jpg'
  },
  {
    gutenbergId: 64317,
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    coverUrl: 'https://covers.openlibrary.org/b/id/10590366-M.jpg'
  },
  {
    gutenbergId: 730,
    title: 'Oliver Twist',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/13300802-M.jpg'
  },
  {
    gutenbergId: 996,
    title: 'Don Quixote',
    author: 'Miguel de Cervantes',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229890-M.jpg'
  },
  {
    gutenbergId: 1184,
    title: 'The Count of Monte Cristo',
    author: 'Alexandre Dumas',
    coverUrl: 'https://covers.openlibrary.org/b/id/8851690-M.jpg'
  },
  {
    gutenbergId: 844,
    title: 'The Importance of Being Earnest',
    author: 'Oscar Wilde',
    coverUrl: 'https://covers.openlibrary.org/b/id/1260453-M.jpg'
  },
  {
    gutenbergId: 219,
    title: 'Heart of Darkness',
    author: 'Joseph Conrad',
    coverUrl: 'https://covers.openlibrary.org/b/id/12307847-M.jpg'
  },
  {
    gutenbergId: 5200,
    title: 'Metamorphosis',
    author: 'Franz Kafka',
    coverUrl: 'https://covers.openlibrary.org/b/id/8599540-M.jpg'
  },
  {
    gutenbergId: 4300,
    title: 'Ulysses',
    author: 'James Joyce',
    coverUrl: 'https://covers.openlibrary.org/b/id/13136548-M.jpg'
  },
  {
    gutenbergId: 1727,
    title: 'The Odyssey',
    author: 'Homer',
    coverUrl: 'https://covers.openlibrary.org/b/id/12474938-M.jpg'
  },
  {
    gutenbergId: 6130,
    title: 'The Iliad',
    author: 'Homer',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229580-M.jpg'
  },
  {
    gutenbergId: 1513,
    title: 'Romeo and Juliet',
    author: 'William Shakespeare',
    coverUrl: 'https://covers.openlibrary.org/b/id/8257991-M.jpg'
  },
  {
    gutenbergId: 1524,
    title: 'Hamlet',
    author: 'William Shakespeare',
    coverUrl: 'https://covers.openlibrary.org/b/id/8281954-M.jpg'
  },
  {
    gutenbergId: 1533,
    title: 'Macbeth',
    author: 'William Shakespeare',
    coverUrl: 'https://covers.openlibrary.org/b/id/872432-M.jpg'
  },
  {
    gutenbergId: 120,
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    coverUrl: 'https://covers.openlibrary.org/b/id/13859660-M.jpg'
  },
  {
    gutenbergId: 43,
    title: 'The Strange Case of Dr. Jekyll and Mr. Hyde',
    author: 'Robert Louis Stevenson',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645126-M.jpg'
  },
  {
    gutenbergId: 2591,
    title: "Grimm's Fairy Tales",
    author: 'Brothers Grimm',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229578-M.jpg'
  }
];
