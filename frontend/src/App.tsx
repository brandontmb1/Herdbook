import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [todos, setTodos] = useState<any[]>([])

  useEffect(() => {
    getTodos()
  }, [])

  async function getTodos() {
    const { data } = await supabase.from('todos').select()
    if (data) setTodos(data)
  }

  return (
    <div>
      <h1>My Local Supabase Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.task}</li>
        ))}
      </ul>
    </div>
  )
}

export default App