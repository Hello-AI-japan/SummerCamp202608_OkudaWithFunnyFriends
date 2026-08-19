export type CustomField = {
  label: string;
  value: string;
};

export type Friend = {
  id: string;
  real_name: string;
  nickname: string;
  hometown: string;
  birthdate: string; // ISO 8601 (YYYY-MM-DD)
  phone_number: string;
  attributes: CustomField[];
};

export type NewFriendInput = {
  real_name: string;
  nickname: string;
  hometown: string;
  birthdate: string;
  phone_number: string;
  attributes: CustomField[];
};
