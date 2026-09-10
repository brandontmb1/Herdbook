create table todos (
  id serial primary key,
  task text not null,
  is_complete boolean default false
);