// Modern JavaScript Examples

// 1. Async/Await with Fetch API
async function fetchUserData(userId) {
  try {
    const response = await fetch(
      `https://jsonplaceholder.typicode.com/users/${userId}`
    );
    const user = await response.json();
    return user;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
}

// 2. Array Methods and Functional Programming
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const processNumbers = (arr) => {
  return arr
    .filter((num) => num % 2 === 0) // Get even numbers
    .map((num) => num * 2) // Double them
    .reduce((sum, num) => sum + num, 0); // Sum them up
};

console.log('Processed numbers:', processNumbers(numbers)); // 60

// 3. ES6+ Features
class TaskManager {
  constructor() {
    this.tasks = [];
  }

  addTask(task) {
    const newTask = {
      id: Date.now(),
      text: task,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(newTask);
    return newTask;
  }

  completeTask(id) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
    }
    return task;
  }

  getTasks(filter = 'all') {
    switch (filter) {
      case 'completed':
        return this.tasks.filter((t) => t.completed);
      case 'pending':
        return this.tasks.filter((t) => !t.completed);
      default:
        return this.tasks;
    }
  }
}

// 4. Destructuring and Spread Operator
const user = {
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
  preferences: {
    theme: 'dark',
    notifications: true,
  },
};

// Destructuring with renaming and defaults
const {
  name,
  age,
  email,
  preferences: { theme = 'light' },
} = user;
console.log(`${name} (${age}) prefers ${theme} theme`);

// Spread operator for object merging
const updatedUser = {
  ...user,
  age: 31,
  preferences: {
    ...user.preferences,
    language: 'en',
  },
};

// 5. Promise handling and error management
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processWithRetry(operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Operation failed after ${maxRetries} attempts`);
      }

      await delay(1000 * attempt); // Exponential backoff
    }
  }
}

// 6. Module pattern and closures
const createCounter = (initialValue = 0) => {
  let count = initialValue;

  return {
    increment: () => ++count,
    decrement: () => --count,
    getValue: () => count,
    reset: () => {
      count = initialValue;
      return count;
    },
  };
};

// Usage examples
async function runExamples() {
  console.log('=== JavaScript Examples ===\n');

  // Task Manager
  const taskManager = new TaskManager();
  const task1 = taskManager.addTask('Learn JavaScript');
  const task2 = taskManager.addTask('Build a project');

  taskManager.completeTask(task1.id);
  console.log('Tasks:', taskManager.getTasks());

  // Counter
  const counter = createCounter(5);
  console.log('Counter:', counter.getValue()); // 5
  console.log('Increment:', counter.increment()); // 6
  console.log('Decrement:', counter.decrement()); // 5

  // Async operation with retry
  try {
    const result = await processWithRetry(async () => {
      if (Math.random() > 0.7) {
        return 'Success!';
      }
      throw new Error('Random failure');
    });
    console.log('Retry result:', result);
  } catch (error) {
    console.log('Final error:', error.message);
  }
}

// Export for use in other modules
export { TaskManager, createCounter, processWithRetry, fetchUserData };

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples();
}
