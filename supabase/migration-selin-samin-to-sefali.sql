update products set subcategory = 'سفالی', material = 'سفال', updated_at = now()
where slug in ('selin', 'samin');

select slug, subcategory, material from products where slug in ('selin', 'samin', 'maha', 'tara');
