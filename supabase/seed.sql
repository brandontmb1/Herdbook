-- Create a test herd
insert into herds (name) 
values ('Main Angus Herd');

-- Add a couple of cows to that herd
insert into cattle (herd_id, tag_number, name, breed, cls, birth_date)
values 
  ((select id from herds limit 1), 'A01', 'Bessie', 'Angus', 'Cow', '2025-03-01'),
  ((select id from herds limit 1), 'A02', 'Ferdinand', 'Angus', 'Bull', '2025-04-15');

-- Add a test pasture
insert into pastures (name, coordinates)
values ('North Creek Pasture', '[[-97.123, 33.456], [-97.124, 33.456], [-97.124, 33.457], [-97.123, 33.457]]');