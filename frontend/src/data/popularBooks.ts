import type { BookCardData } from '../components/BookCard';

// Top 20 most popular books from Project Gutenberg
// Cover URLs from covers.openlibrary.org using Open Library IDs
export const POPULAR_BOOKS: BookCardData[] = [
  {
    gutenbergId: 1342,
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    coverUrl: 'https://covers.openlibrary.org/b/id/8231856-M.jpg'
  },
  {
    gutenbergId: 84,
    title: 'Frankenstein',
    author: 'Mary Shelley',
    coverUrl: 'https://covers.openlibrary.org/b/id/6788036-M.jpg'
  },
  {
    gutenbergId: 1661,
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645114-M.jpg'
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
    coverUrl: 'https://covers.openlibrary.org/b/id/8599512-M.jpg'
  },
  {
    gutenbergId: 98,
    title: 'A Tale of Two Cities',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/12813077-M.jpg'
  },
  {
    gutenbergId: 2701,
    title: 'Moby Dick',
    author: 'Herman Melville',
    coverUrl: 'https://covers.openlibrary.org/b/id/12818855-M.jpg'
  },
  {
    gutenbergId: 345,
    title: 'Dracula',
    author: 'Bram Stoker',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645121-M.jpg'
  },
  {
    gutenbergId: 74,
    title: 'The Adventures of Tom Sawyer',
    author: 'Mark Twain',
    coverUrl: 'https://covers.openlibrary.org/b/id/8228691-M.jpg'
  },
  {
    gutenbergId: 1400,
    title: 'Great Expectations',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645069-M.jpg'
  },
  {
    gutenbergId: 16328,
    title: 'Beowulf',
    author: 'Unknown',
    coverUrl: 'https://covers.openlibrary.org/b/id/8406786-M.jpg'
  },
  {
    gutenbergId: 1952,
    title: 'The Yellow Wallpaper',
    author: 'Charlotte Perkins Gilman',
    coverUrl: 'https://covers.openlibrary.org/b/id/8739161-M.jpg'
  },
  {
    gutenbergId: 2542,
    title: 'A Doll\'s House',
    author: 'Henrik Ibsen',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229498-M.jpg'
  },
  {
    gutenbergId: 1080,
    title: 'A Modest Proposal',
    author: 'Jonathan Swift',
    coverUrl: 'https://covers.openlibrary.org/b/id/8230766-M.jpg'
  },
  {
    gutenbergId: 46,
    title: 'A Christmas Carol',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/12783544-M.jpg'
  },
  {
    gutenbergId: 174,
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645134-M.jpg'
  },
  {
    gutenbergId: 768,
    title: 'Wuthering Heights',
    author: 'Emily Brontë',
    coverUrl: 'https://covers.openlibrary.org/b/id/12818910-M.jpg'
  },
  {
    gutenbergId: 1260,
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645072-M.jpg'
  },
  {
    gutenbergId: 35,
    title: 'The Time Machine',
    author: 'H. G. Wells',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645132-M.jpg'
  },
  {
    gutenbergId: 36,
    title: 'The War of the Worlds',
    author: 'H. G. Wells',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645130-M.jpg'
  }
];

// Classic authors section - different selection for variety
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
    coverUrl: 'https://covers.openlibrary.org/b/id/12818854-M.jpg'
  },
  {
    gutenbergId: 2554,
    title: 'Crime and Punishment',
    author: 'Fyodor Dostoyevsky',
    coverUrl: 'https://covers.openlibrary.org/b/id/12818831-M.jpg'
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
    coverUrl: 'https://covers.openlibrary.org/b/id/12818839-M.jpg'
  },
  {
    gutenbergId: 730,
    title: 'Oliver Twist',
    author: 'Charles Dickens',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645078-M.jpg'
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
    coverUrl: 'https://covers.openlibrary.org/b/id/8599546-M.jpg'
  },
  {
    gutenbergId: 844,
    title: 'The Importance of Being Earnest',
    author: 'Oscar Wilde',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229651-M.jpg'
  },
  {
    gutenbergId: 219,
    title: 'Heart of Darkness',
    author: 'Joseph Conrad',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645062-M.jpg'
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
    coverUrl: 'https://covers.openlibrary.org/b/id/12645140-M.jpg'
  },
  {
    gutenbergId: 1727,
    title: 'The Odyssey',
    author: 'Homer',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229579-M.jpg'
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
    coverUrl: 'https://covers.openlibrary.org/b/id/8229642-M.jpg'
  },
  {
    gutenbergId: 1524,
    title: 'Hamlet',
    author: 'William Shakespeare',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229643-M.jpg'
  },
  {
    gutenbergId: 1533,
    title: 'Macbeth',
    author: 'William Shakespeare',
    coverUrl: 'https://covers.openlibrary.org/b/id/8229644-M.jpg'
  },
  {
    gutenbergId: 120,
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    coverUrl: 'https://covers.openlibrary.org/b/id/12645138-M.jpg'
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
